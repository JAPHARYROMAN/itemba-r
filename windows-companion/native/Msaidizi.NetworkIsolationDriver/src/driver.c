#include "driver.h"

#define MNI_NT_DEVICE_NAME L"\\Device\\ItembaMsaidiziIsolation"
#define MNI_DOS_DEVICE_NAME L"\\DosDevices\\ItembaMsaidiziIsolation"

/*
 * Service SID for "Itemba Msaidizi Privileged Command Supervisor". The
 * protected DACL deliberately grants neither Administrators nor LocalSystem
 * as ambient identities. A LocalSystem process must also carry this service
 * SID in its restricted service token to open the device.
 */
/* IoCreateDeviceSecure accepts only the device-object SDDL subset. Start with
 * SYSTEM-only access, then replace it before publishing the symbolic link with
 * an ACL containing only the purpose-specific service SID. */
#define MNI_BOOTSTRAP_DEVICE_SDDL L"D:P(A;;GA;;;SY)"

static const GUID g_MniDeviceClassGuid =
  { 0x0e352ba0, 0xe1ae, 0x4c46, { 0xbc, 0xd8, 0x22, 0xd9, 0xe8, 0x8c, 0xb9, 0x5c } };

typedef struct _MNI_SUPERVISOR_SID {
  UCHAR Revision;
  UCHAR SubAuthorityCount;
  SID_IDENTIFIER_AUTHORITY IdentifierAuthority;
  ULONG SubAuthority[6];
} MNI_SUPERVISOR_SID;

static const MNI_SUPERVISOR_SID g_MniSupervisorSid = {
  SID_REVISION,
  6,
  SECURITY_NT_AUTHORITY,
  { 80, 1792805186, 3282615177, 1795010573, 3676175622, 4117989893 }
};

/*
 * The resident C# WindowsKernelIsolationDriverClient uses a different v2 JSON
 * lifecycle protocol. This network-only driver cannot truthfully attest, bind
 * a suspended process to a protected job, or kill that process tree on handle
 * loss. Each legacy IOCTL therefore returns an explicit, parseable denial.
 */
static const CHAR g_LegacyAttestDenied[] =
  "{\"accepted\":false,\"errorCode\":\"LEGACY_NOT_PROVISIONED\","
  "\"signedAttestation\":null}";
static const CHAR g_LegacyBindDenied[] =
  "{\"accepted\":false,\"errorCode\":\"LEGACY_NOT_PROVISIONED\","
  "\"enforcementLeaseId\":\"\",\"jobObjectId\":\"\","
  "\"jobObjectIdentitySha256\":\"\",\"imagePathSha256\":\"\","
  "\"imageSha256\":\"\",\"imageVolumeSerialNumber\":0,\"imageFileId\":0,"
  "\"commandLineSha256\":\"\",\"workingDirectorySha256\":\"\","
  "\"environmentBlockSha256\":\"\",\"invocationSha256\":\"\","
  "\"childStillSuspended\":true,\"assignedToJob\":false,"
  "\"kernelEnforcementActive\":false,\"enforcedFeatures\":[],"
  "\"enforcementEvidenceSha256\":\"\"}";
static const CHAR g_LegacySettleDenied[] =
  "{\"accepted\":false,\"errorCode\":\"LEGACY_NOT_PROVISIONED\","
  "\"processResumed\":false,\"resumedAtUnixMilliseconds\":0,"
  "\"endedAtUnixMilliseconds\":0,\"processTreeTerminal\":false,"
  "\"enforcementContinuous\":false,\"exitCodeKnown\":false,\"exitCode\":0,"
  "\"enforcementEvidenceSha256\":\"\",\"outcome\":\"not-provisioned\"}";

MNI_DRIVER_STATE g_Mni;

static BOOLEAN
MniBytesAreZeroLocal(_In_reads_(length) const UCHAR* value, _In_ SIZE_T length)
{
  UCHAR combined = 0;
  SIZE_T index;

  for (index = 0; index < length; ++index) {
    combined |= value[index];
  }
  return combined == 0;
}

static NTSTATUS
MniCompleteIrp(_Inout_ PIRP irp, _In_ NTSTATUS status, _In_ ULONG_PTR information)
{
  irp->IoStatus.Status = status;
  irp->IoStatus.Information = information;
  IoCompleteRequest(irp, IO_NO_INCREMENT);
  return status;
}

static VOID
MniLatchKillWithoutRequest(VOID)
{
  LONG64 observed;
  LONG64 replacement;

  do {
    observed = InterlockedCompareExchange64(&g_Mni.KillGeneration, 0, 0);
    if ((UINT64)observed == ~0ull) {
      break;
    }
    replacement = (LONG64)((UINT64)observed + 1);
  } while (InterlockedCompareExchange64(
             &g_Mni.KillGeneration,
             replacement,
             observed) != observed);
  InterlockedExchange(&g_Mni.KillActive, 1);
}

static BOOLEAN
MniTokenInformationContainsSupervisorSid(
  _In_ PACCESS_TOKEN token,
  _In_ TOKEN_INFORMATION_CLASS informationClass)
{
  PTOKEN_GROUPS groups = NULL;
  ULONG index;
  BOOLEAN found = FALSE;
  NTSTATUS status;

  status = SeQueryInformationToken(token, informationClass, (PVOID*)&groups);
  if (!NT_SUCCESS(status) || groups == NULL) {
    return FALSE;
  }
  for (index = 0; index < groups->GroupCount; ++index) {
    if ((groups->Groups[index].Attributes & SE_GROUP_ENABLED) != 0 &&
        (groups->Groups[index].Attributes & SE_GROUP_USE_FOR_DENY_ONLY) == 0 &&
        RtlEqualSid(groups->Groups[index].Sid, (PSID)&g_MniSupervisorSid)) {
      found = TRUE;
      break;
    }
  }
  ExFreePool(groups);
  return found;
}

static BOOLEAN
MniRequestorIsSupervisor(_In_ PIRP irp)
{
  PEPROCESS requestor;
  PACCESS_TOKEN token;
  BOOLEAN authorized;

  requestor = IoGetRequestorProcess(irp);
  if (requestor == NULL) {
    return FALSE;
  }
  token = PsReferencePrimaryToken(requestor);
  if (token == NULL) {
    return FALSE;
  }
  authorized = MniTokenInformationContainsSupervisorSid(token, TokenGroups) ||
    MniTokenInformationContainsSupervisorSid(token, TokenRestrictedSids);
  PsDereferencePrimaryToken(token);
  return authorized;
}

static NTSTATUS
MniApplySupervisorOnlyDeviceDacl(_In_ PDEVICE_OBJECT deviceObject)
{
  UCHAR aclBuffer[
    sizeof(ACL) + sizeof(ACCESS_ALLOWED_ACE) - sizeof(ULONG) +
    sizeof(MNI_SUPERVISOR_SID)];
  PACL acl = (PACL)aclBuffer;
  SECURITY_DESCRIPTOR descriptor;
  HANDLE deviceHandle = NULL;
  NTSTATUS status;

  RtlZeroMemory(aclBuffer, sizeof(aclBuffer));
  status = RtlCreateAcl(acl, sizeof(aclBuffer), ACL_REVISION);
  if (!NT_SUCCESS(status)) {
    return status;
  }
  status = RtlAddAccessAllowedAceEx(
    acl,
    ACL_REVISION,
    0,
    GENERIC_ALL,
    (PSID)&g_MniSupervisorSid);
  if (!NT_SUCCESS(status)) {
    return status;
  }
  status = RtlCreateSecurityDescriptor(&descriptor, SECURITY_DESCRIPTOR_REVISION);
  if (!NT_SUCCESS(status)) {
    return status;
  }
  status = RtlSetDaclSecurityDescriptor(&descriptor, TRUE, acl, FALSE);
  if (!NT_SUCCESS(status)) {
    return status;
  }
  status = ObOpenObjectByPointer(
    deviceObject,
    OBJ_KERNEL_HANDLE,
    NULL,
    WRITE_DAC,
    *IoDeviceObjectType,
    KernelMode,
    &deviceHandle);
  if (!NT_SUCCESS(status)) {
    return status;
  }
  status = ZwSetSecurityObject(deviceHandle, DACL_SECURITY_INFORMATION, &descriptor);
  ZwClose(deviceHandle);
  return status;
}

static NTSTATUS
MniCopyLegacyDenial(
  _Inout_ PIRP irp,
  _In_ ULONG outputLength,
  _In_reads_bytes_(responseLength) const CHAR* response,
  _In_ ULONG responseLength)
{
  if (irp->AssociatedIrp.SystemBuffer == NULL || outputLength < responseLength) {
    return MniCompleteIrp(irp, STATUS_BUFFER_TOO_SMALL, 0);
  }
  RtlCopyMemory(irp->AssociatedIrp.SystemBuffer, response, responseLength);
  return MniCompleteIrp(irp, STATUS_SUCCESS, responseLength);
}

VOID
MniFillResponseHeader(
  _Out_ MNI_MESSAGE_HEADER* header,
  _In_ USHORT messageType,
  _In_ ULONG size,
  _In_opt_ const MNI_MESSAGE_HEADER* request)
{
  RtlZeroMemory(header, sizeof(*header));
  header->Size = size;
  header->Version = MNI_PROTOCOL_VERSION;
  header->MessageType = messageType;
  if (request != NULL) {
    header->RequestSequence = request->RequestSequence;
    header->PolicyGeneration = request->PolicyGeneration;
    RtlCopyMemory(header->RequestId, request->RequestId, MNI_UUID_BYTES);
  }
  RtlCopyMemory(header->BootId, g_Mni.BootId, MNI_UUID_BYTES);
}

static BOOLEAN
MniProtocolRequestValid(_In_ const MNI_MESSAGE_HEADER* request)
{
  return request != NULL &&
    request->Size == sizeof(*request) &&
    request->Version == MNI_PROTOCOL_VERSION &&
    request->MessageType == MNI_MESSAGE_PROTOCOL_REQUEST &&
    request->Flags == 0 &&
    request->Reserved == 0 &&
    request->RequestSequence == 0 &&
    request->PolicyGeneration == 0 &&
    !MniBytesAreZeroLocal(request->RequestId, MNI_UUID_BYTES) &&
    MniBytesAreZeroLocal(request->BootId, MNI_UUID_BYTES);
}

static NTSTATUS
MniGetProtocol(
  _In_ const MNI_MESSAGE_HEADER* request,
  _Out_ MNI_PROTOCOL_RESPONSE* response)
{
  if (!MniProtocolRequestValid(request)) {
    return STATUS_INVALID_PARAMETER;
  }
  RtlZeroMemory(response, sizeof(*response));
  MniFillResponseHeader(
    &response->Header,
    MNI_MESSAGE_PROTOCOL_RESPONSE,
    sizeof(*response),
    request);
  response->MinimumVersion = MNI_PROTOCOL_VERSION;
  response->MaximumVersion = MNI_PROTOCOL_VERSION;
  response->MaximumFrameBytes = MNI_MAX_FRAME_BYTES;
  response->Features = MNI_REQUIRED_FEATURES;
  response->MessageHeaderSize = sizeof(MNI_MESSAGE_HEADER);
  response->PolicyEntrySize = sizeof(MNI_POLICY_ENTRY);
  response->PolicyRequestBaseSize = MNI_POLICY_REPLACE_BASE_SIZE;
  response->EnrollmentRequestSize = sizeof(MNI_PROCESS_ENROLL_REQUEST);
  response->HealthResponseSize = sizeof(MNI_HEALTH_RESPONSE);
  return STATUS_SUCCESS;
}

NTSTATUS
MniDispatchCreate(_In_ PDEVICE_OBJECT deviceObject, _Inout_ PIRP irp)
{
  UNREFERENCED_PARAMETER(deviceObject);
  if (!MniRequestorIsSupervisor(irp)) {
    return MniCompleteIrp(irp, STATUS_ACCESS_DENIED, 0);
  }
  if (InterlockedCompareExchange(&g_Mni.Unloading, 0, 0) != 0 ||
      InterlockedCompareExchange(&g_Mni.WfpRegistered, 0, 0) == 0) {
    return MniCompleteIrp(irp, STATUS_DEVICE_NOT_READY, 0);
  }
  if (InterlockedCompareExchange(&g_Mni.OpenHandle, 1, 0) != 0) {
    return MniCompleteIrp(irp, STATUS_SHARING_VIOLATION, 0);
  }
  return MniCompleteIrp(irp, STATUS_SUCCESS, 0);
}

NTSTATUS
MniDispatchCleanup(_In_ PDEVICE_OBJECT deviceObject, _Inout_ PIRP irp)
{
  UNREFERENCED_PARAMETER(deviceObject);
  if (InterlockedExchange(&g_Mni.OpenHandle, 0) != 0) {
    /* Network fail-close only: future ALE connects from enrolled identities are
     * blocked. This does not terminate existing sockets or process trees. */
    MniLatchKillWithoutRequest();
  }
  return MniCompleteIrp(irp, STATUS_SUCCESS, 0);
}

NTSTATUS
MniDispatchClose(_In_ PDEVICE_OBJECT deviceObject, _Inout_ PIRP irp)
{
  UNREFERENCED_PARAMETER(deviceObject);
  return MniCompleteIrp(irp, STATUS_SUCCESS, 0);
}

static NTSTATUS
MniDispatchUnsupported(_In_ PDEVICE_OBJECT deviceObject, _Inout_ PIRP irp)
{
  UNREFERENCED_PARAMETER(deviceObject);
  return MniCompleteIrp(irp, STATUS_INVALID_DEVICE_REQUEST, 0);
}

NTSTATUS
MniDispatchDeviceControl(_In_ PDEVICE_OBJECT deviceObject, _Inout_ PIRP irp)
{
  PIO_STACK_LOCATION stack;
  PVOID buffer;
  ULONG code;
  ULONG inputLength;
  ULONG outputLength;
  ULONG_PTR information = 0;
  PVOID inputCopy = NULL;
  NTSTATUS status = STATUS_INVALID_DEVICE_REQUEST;

  UNREFERENCED_PARAMETER(deviceObject);
  stack = IoGetCurrentIrpStackLocation(irp);
  code = stack->Parameters.DeviceIoControl.IoControlCode;
  inputLength = stack->Parameters.DeviceIoControl.InputBufferLength;
  outputLength = stack->Parameters.DeviceIoControl.OutputBufferLength;
  buffer = irp->AssociatedIrp.SystemBuffer;

  if (!MniRequestorIsSupervisor(irp)) {
    return MniCompleteIrp(irp, STATUS_ACCESS_DENIED, 0);
  }
  if (inputLength > MNI_MAX_FRAME_BYTES || outputLength > MNI_MAX_FRAME_BYTES ||
      buffer == NULL) {
    InterlockedIncrement64(&g_Mni.Counters.InvalidIoctls);
    return MniCompleteIrp(irp, STATUS_INVALID_BUFFER_SIZE, 0);
  }

  /* Legacy v2 is a deliberately separate, always-denied compatibility edge. */
  switch (code) {
    case MNI_IOCTL_LEGACY_ATTEST:
      return MniCopyLegacyDenial(
        irp,
        outputLength,
        g_LegacyAttestDenied,
        sizeof(g_LegacyAttestDenied) - 1);

    case MNI_IOCTL_LEGACY_BIND:
      return MniCopyLegacyDenial(
        irp,
        outputLength,
        g_LegacyBindDenied,
        sizeof(g_LegacyBindDenied) - 1);

    case MNI_IOCTL_LEGACY_SETTLE:
    case MNI_IOCTL_LEGACY_RECOVER:
      return MniCopyLegacyDenial(
        irp,
        outputLength,
        g_LegacySettleDenied,
        sizeof(g_LegacySettleDenied) - 1);

    default:
      break;
  }

  if (inputLength != 0) {
    inputCopy = ExAllocatePool2(POOL_FLAG_PAGED, inputLength, MNI_POOL_TAG_IO);
    if (inputCopy == NULL) {
      return MniCompleteIrp(irp, STATUS_INSUFFICIENT_RESOURCES, 0);
    }
    RtlCopyMemory(inputCopy, buffer, inputLength);
  }

  /* METHOD_BUFFERED aliases input and output. All request validation and
   * hashing therefore reads the immutable copy, never response-overwritten
   * bytes from SystemBuffer. */
  switch (code) {

    case MNI_IOCTL_GET_PROTOCOL:
      if (inputLength != sizeof(MNI_MESSAGE_HEADER) ||
          outputLength < sizeof(MNI_PROTOCOL_RESPONSE)) {
        status = STATUS_INFO_LENGTH_MISMATCH;
        break;
      }
      status = MniGetProtocol(
        (const MNI_MESSAGE_HEADER*)inputCopy,
        (MNI_PROTOCOL_RESPONSE*)buffer);
      if (NT_SUCCESS(status)) {
        information = sizeof(MNI_PROTOCOL_RESPONSE);
      }
      break;

    case MNI_IOCTL_GET_HEALTH:
      if (inputLength != sizeof(MNI_HEALTH_REQUEST) ||
          outputLength < sizeof(MNI_HEALTH_RESPONSE)) {
        status = STATUS_INFO_LENGTH_MISMATCH;
        break;
      }
      status = MniGetHealth(
        (const MNI_HEALTH_REQUEST*)inputCopy,
        (MNI_HEALTH_RESPONSE*)buffer);
      if (NT_SUCCESS(status)) {
        information = sizeof(MNI_HEALTH_RESPONSE);
      }
      break;

    case MNI_IOCTL_REPLACE_POLICY:
      if (inputLength < MNI_POLICY_REPLACE_BASE_SIZE ||
          outputLength < sizeof(MNI_MUTATION_RESPONSE)) {
        status = STATUS_INFO_LENGTH_MISMATCH;
        break;
      }
      status = MniReplacePolicy(
        (const MNI_POLICY_REPLACE_REQUEST*)inputCopy,
        inputLength,
        (MNI_MUTATION_RESPONSE*)buffer);
      if (NT_SUCCESS(status)) {
        information = sizeof(MNI_MUTATION_RESPONSE);
      }
      break;

    case MNI_IOCTL_ENROLL_PROCESS:
      if (inputLength != sizeof(MNI_PROCESS_ENROLL_REQUEST) ||
          outputLength < sizeof(MNI_MUTATION_RESPONSE)) {
        status = STATUS_INFO_LENGTH_MISMATCH;
        break;
      }
      status = MniEnrollProcess(
        (const MNI_PROCESS_ENROLL_REQUEST*)inputCopy,
        (MNI_MUTATION_RESPONSE*)buffer);
      if (NT_SUCCESS(status)) {
        information = sizeof(MNI_MUTATION_RESPONSE);
      }
      break;

    case MNI_IOCTL_REMOVE_PROCESS:
      if (inputLength != sizeof(MNI_PROCESS_REMOVE_REQUEST) ||
          outputLength < sizeof(MNI_MUTATION_RESPONSE)) {
        status = STATUS_INFO_LENGTH_MISMATCH;
        break;
      }
      status = MniRemoveProcess(
        (const MNI_PROCESS_REMOVE_REQUEST*)inputCopy,
        (MNI_MUTATION_RESPONSE*)buffer);
      if (NT_SUCCESS(status)) {
        information = sizeof(MNI_MUTATION_RESPONSE);
      }
      break;

    case MNI_IOCTL_SET_KILL_STATE:
      if (inputLength != sizeof(MNI_KILL_REQUEST) ||
          outputLength < sizeof(MNI_MUTATION_RESPONSE)) {
        status = STATUS_INFO_LENGTH_MISMATCH;
        break;
      }
      status = MniSetKillState(
        (const MNI_KILL_REQUEST*)inputCopy,
        (MNI_MUTATION_RESPONSE*)buffer);
      if (NT_SUCCESS(status)) {
        information = sizeof(MNI_MUTATION_RESPONSE);
      }
      break;

    default:
      status = STATUS_INVALID_DEVICE_REQUEST;
      break;
  }

  if (!NT_SUCCESS(status)) {
    InterlockedIncrement64(&g_Mni.Counters.InvalidIoctls);
  }
  if (inputCopy != NULL) {
    RtlSecureZeroMemory(inputCopy, inputLength);
    ExFreePoolWithTag(inputCopy, MNI_POOL_TAG_IO);
  }
  return MniCompleteIrp(irp, status, information);
}

_IRQL_requires_max_(PASSIVE_LEVEL)
VOID
MniDriverUnload(_In_ PDRIVER_OBJECT driverObject)
{
  UNREFERENCED_PARAMETER(driverObject);
  PAGED_CODE();
  InterlockedExchange(&g_Mni.Unloading, 1);
  MniLatchKillWithoutRequest();
  MniWfpStop();
  MniDestroyAllPolicy();
  IoDeleteSymbolicLink(&g_Mni.SymbolicLink);
  if (g_Mni.DeviceObject != NULL) {
    IoDeleteDevice(g_Mni.DeviceObject);
    g_Mni.DeviceObject = NULL;
  }
  RtlSecureZeroMemory(g_Mni.ReplayIds, sizeof(g_Mni.ReplayIds));
}

_IRQL_requires_max_(PASSIVE_LEVEL)
NTSTATUS
DriverEntry(_In_ PDRIVER_OBJECT driverObject, _In_ PUNICODE_STRING registryPath)
{
  UNICODE_STRING deviceName;
  UNICODE_STRING sddl;
  LARGE_INTEGER now;
  ULONG index;
  NTSTATUS status;

  UNREFERENCED_PARAMETER(registryPath);
  PAGED_CODE();
  RtlZeroMemory(&g_Mni, sizeof(g_Mni));
  KeInitializeSpinLock(&g_Mni.PolicyPointerLock);
  KeInitializeSpinLock(&g_Mni.ProcessPointerLock);
  ExInitializeFastMutex(&g_Mni.MutationMutex);
  KeQuerySystemTimePrecise(&now);
  g_Mni.BootTimeFileTime100ns = (UINT64)now.QuadPart - KeQueryInterruptTime();
  status = BCryptGenRandom(
    NULL,
    g_Mni.BootId,
    sizeof(g_Mni.BootId),
    BCRYPT_USE_SYSTEM_PREFERRED_RNG);
  if (!NT_SUCCESS(status) ||
      MniBytesAreZeroLocal(g_Mni.BootId, sizeof(g_Mni.BootId))) {
    RtlSecureZeroMemory(&g_Mni, sizeof(g_Mni));
    return NT_SUCCESS(status) ? STATUS_UNSUCCESSFUL : status;
  }

  for (index = 0; index <= IRP_MJ_MAXIMUM_FUNCTION; ++index) {
    driverObject->MajorFunction[index] = MniDispatchUnsupported;
  }
  driverObject->MajorFunction[IRP_MJ_CREATE] = MniDispatchCreate;
  driverObject->MajorFunction[IRP_MJ_CLEANUP] = MniDispatchCleanup;
  driverObject->MajorFunction[IRP_MJ_CLOSE] = MniDispatchClose;
  driverObject->MajorFunction[IRP_MJ_DEVICE_CONTROL] = MniDispatchDeviceControl;
  driverObject->DriverUnload = MniDriverUnload;

  RtlInitUnicodeString(&deviceName, MNI_NT_DEVICE_NAME);
  RtlInitUnicodeString(&sddl, MNI_BOOTSTRAP_DEVICE_SDDL);
  status = IoCreateDeviceSecure(
    driverObject,
    0,
    &deviceName,
    FILE_DEVICE_UNKNOWN,
    FILE_DEVICE_SECURE_OPEN,
    TRUE,
    &sddl,
    &g_MniDeviceClassGuid,
    &g_Mni.DeviceObject);
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }
  g_Mni.DeviceObject->Flags |= DO_BUFFERED_IO;
  status = MniApplySupervisorOnlyDeviceDacl(g_Mni.DeviceObject);
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }
  RtlInitUnicodeString(&g_Mni.SymbolicLink, MNI_DOS_DEVICE_NAME);
  status = IoCreateSymbolicLink(&g_Mni.SymbolicLink, &deviceName);
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }
  status = MniWfpStart(g_Mni.DeviceObject);
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }
  g_Mni.DeviceObject->Flags &= ~DO_DEVICE_INITIALIZING;
  return STATUS_SUCCESS;

Exit:
  InterlockedExchange(&g_Mni.Unloading, 1);
  MniWfpStop();
  MniDestroyAllPolicy();
  if (g_Mni.SymbolicLink.Buffer != NULL) {
    IoDeleteSymbolicLink(&g_Mni.SymbolicLink);
  }
  if (g_Mni.DeviceObject != NULL) {
    IoDeleteDevice(g_Mni.DeviceObject);
    g_Mni.DeviceObject = NULL;
  }
  RtlSecureZeroMemory(g_Mni.BootId, sizeof(g_Mni.BootId));
  return status;
}

#pragma alloc_text(INIT, DriverEntry)
#pragma alloc_text(PAGE, MniDriverUnload)
