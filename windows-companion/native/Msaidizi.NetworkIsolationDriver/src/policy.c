#include "driver.h"

#define MNI_MAX_POLICY_LIFETIME_100NS (2ull * 60ull * 60ull * 10000000ull)

static const UCHAR g_ProcessIdentityDomain[] =
  "MSAIDIZI-NETWORK-PROCESS-IDENTITY-V1\0";
static const UCHAR g_PolicyDomain[] =
  "MSAIDIZI-NETWORK-POLICY-V1\0";
static const UCHAR g_HealthDomain[] =
  "MSAIDIZI-NETWORK-DRIVER-HEALTH-V1\0";

static BOOLEAN
MniBytesEqual(
  _In_reads_(length) const UCHAR* left,
  _In_reads_(length) const UCHAR* right,
  _In_ SIZE_T length)
{
  UCHAR difference = 0;
  SIZE_T index;

  for (index = 0; index < length; ++index) {
    difference |= (UCHAR)(left[index] ^ right[index]);
  }
  return difference == 0;
}

static BOOLEAN
MniBytesAreZero(
  _In_reads_(length) const UCHAR* value,
  _In_ SIZE_T length)
{
  UCHAR combined = 0;
  SIZE_T index;

  for (index = 0; index < length; ++index) {
    combined |= value[index];
  }
  return combined == 0;
}

static INT
MniByteCompare(
  _In_reads_(length) const UCHAR* left,
  _In_reads_(length) const UCHAR* right,
  _In_ SIZE_T length)
{
  SIZE_T index;

  for (index = 0; index < length; ++index) {
    if (left[index] < right[index]) {
      return -1;
    }
    if (left[index] > right[index]) {
      return 1;
    }
  }
  return 0;
}

static UINT64
MniSystemTime100ns(VOID)
{
  LARGE_INTEGER now;
  KeQuerySystemTimePrecise(&now);
  return (UINT64)now.QuadPart;
}

static BOOLEAN
MniHeaderShapeValid(
  _In_ const MNI_MESSAGE_HEADER* header,
  _In_ ULONG expectedSize,
  _In_ USHORT expectedType)
{
  return header != NULL &&
    header->Size == expectedSize &&
    header->Version == MNI_PROTOCOL_VERSION &&
    header->MessageType == expectedType &&
    header->Flags == 0 &&
    header->Reserved == 0;
}

static BOOLEAN
MniReplaySeenLocked(_In_reads_(MNI_UUID_BYTES) const UCHAR requestId[MNI_UUID_BYTES])
{
  ULONG index;

  for (index = 0; index < MNI_REPLAY_WINDOW; ++index) {
    if (MniBytesEqual(g_Mni.ReplayIds[index], requestId, MNI_UUID_BYTES)) {
      return TRUE;
    }
  }
  return FALSE;
}

static ULONG
MniValidateMutationHeaderLocked(
  _In_ const MNI_MESSAGE_HEADER* header,
  _In_ ULONG expectedSize,
  _In_ USHORT expectedType,
  _In_ BOOLEAN replacement)
{
  PMNI_POLICY_SNAPSHOT policy;
  UINT64 currentGeneration = 0;

  if (!MniHeaderShapeValid(header, expectedSize, expectedType)) {
    return MNI_STATUS_INVALID_FRAME;
  }
  if (!MniBytesEqual(header->BootId, g_Mni.BootId, MNI_UUID_BYTES)) {
    return MNI_STATUS_BOOT_MISMATCH;
  }
  if (header->RequestSequence == 0 ||
      header->RequestSequence <= (UINT64)InterlockedCompareExchange64(
        &g_Mni.LastRequestSequence, 0, 0) ||
      MniBytesAreZero(header->RequestId, MNI_UUID_BYTES) ||
      MniReplaySeenLocked(header->RequestId)) {
    InterlockedIncrement64(&g_Mni.Counters.ReplayRejections);
    return MNI_STATUS_REPLAY;
  }

  policy = MniAcquirePolicy();
  if (policy != NULL) {
    currentGeneration = policy->Generation;
  }
  MniReleasePolicy(policy);

  if ((expectedType == MNI_MESSAGE_KILL_REQUEST &&
       header->PolicyGeneration != 0) ||
      (expectedType != MNI_MESSAGE_KILL_REQUEST && replacement &&
       (header->PolicyGeneration == 0 ||
        header->PolicyGeneration != currentGeneration + 1)) ||
      (expectedType != MNI_MESSAGE_KILL_REQUEST && !replacement &&
       header->PolicyGeneration != currentGeneration)) {
    return MNI_STATUS_STALE_GENERATION;
  }
  if (InterlockedCompareExchange(&g_Mni.KillActive, 0, 0) != 0 &&
      expectedType != MNI_MESSAGE_KILL_REQUEST) {
    return MNI_STATUS_KILL_ACTIVE;
  }
  return MNI_STATUS_OK;
}

static VOID
MniCommitReplayLocked(_In_ const MNI_MESSAGE_HEADER* header)
{
  InterlockedExchange64(
    &g_Mni.LastRequestSequence,
    (LONG64)header->RequestSequence);
  RtlCopyMemory(
    g_Mni.ReplayIds[g_Mni.ReplayCursor % MNI_REPLAY_WINDOW],
    header->RequestId,
    MNI_UUID_BYTES);
  g_Mni.ReplayCursor = (g_Mni.ReplayCursor + 1) % MNI_REPLAY_WINDOW;
}

static VOID
MniFillMutationResponse(
  _Out_ MNI_MUTATION_RESPONSE* response,
  _In_ const MNI_MESSAGE_HEADER* request,
  _In_ ULONG status,
  _In_ NTSTATUS detail)
{
  PMNI_POLICY_SNAPSHOT policy;

  RtlZeroMemory(response, sizeof(*response));
  MniFillResponseHeader(
    &response->Header,
    MNI_MESSAGE_MUTATION_RESPONSE,
    sizeof(*response),
    request);
  response->Status = status;
  response->ErrorDetail = (ULONG)detail;
  response->AppliedRequestSequence =
    status == MNI_STATUS_OK ? request->RequestSequence :
      (UINT64)InterlockedCompareExchange64(&g_Mni.LastRequestSequence, 0, 0);

  policy = MniAcquirePolicy();
  if (policy != NULL) {
    response->CurrentPolicyGeneration = policy->Generation;
    RtlCopyMemory(
      response->CurrentPolicySha256,
      policy->Sha256,
      MNI_SHA256_BYTES);
  }
  MniReleasePolicy(policy);
}

static BOOLEAN
MniNormalizedImagePathValid(
  _In_reads_(length) const USHORT* value,
  _In_ USHORT length)
{
  USHORT index;

  if (value == NULL || length < 9 || length >= MNI_MAX_IMAGE_PATH_CHARS ||
      value[0] != L'\\' || value[length] != 0) {
    return FALSE;
  }
  for (index = 0; index < length; ++index) {
    WCHAR character = (WCHAR)value[index];
    if (character == 0 || character < 0x20 || character == L'/' ||
        RtlUpcaseUnicodeChar(character) != character) {
      return FALSE;
    }
  }
  return TRUE;
}

static BOOLEAN
MniNormalizedAppIdValid(
  _In_reads_bytes_(length) const UCHAR* value,
  _In_ USHORT length)
{
  USHORT index;

  if (value == NULL || length < sizeof(WCHAR) ||
      length > MNI_MAX_APP_ID_BYTES || (length % sizeof(WCHAR)) != 0) {
    return FALSE;
  }
  for (index = 0; index < length / sizeof(WCHAR); ++index) {
    USHORT character = ((const USHORT*)value)[index];
    if (character == 0 && index + 1 != length / sizeof(WCHAR)) {
      return FALSE;
    }
    if (character != 0 && character < 0x20) {
      return FALSE;
    }
  }
  return TRUE;
}

static BOOLEAN
MniAddressIsCanonical(
  _In_ const MNI_POLICY_ENTRY* entry)
{
  ULONG addressBytes;
  ULONG prefix;
  ULONG index;

  addressBytes = entry->AddressFamily == MNI_ADDRESS_FAMILY_IPV4 ? 4u : 16u;
  prefix = entry->PrefixLength;
  if ((entry->AddressFamily == MNI_ADDRESS_FAMILY_IPV4 && prefix > 32) ||
      (entry->AddressFamily == MNI_ADDRESS_FAMILY_IPV6 && prefix > 128)) {
    return FALSE;
  }
  for (index = addressBytes; index < 16; ++index) {
    if (entry->RemoteAddress[index] != 0) {
      return FALSE;
    }
  }
  for (index = 0; index < addressBytes; ++index) {
    ULONG bitsBefore = index * 8;
    if (prefix >= bitsBefore + 8) {
      continue;
    }
    if (prefix <= bitsBefore) {
      if (entry->RemoteAddress[index] != 0) {
        return FALSE;
      }
    } else {
      UCHAR hostMask = (UCHAR)((1u << (8 - (prefix - bitsBefore))) - 1u);
      if ((entry->RemoteAddress[index] & hostMask) != 0) {
        return FALSE;
      }
    }
  }
  return TRUE;
}

static BOOLEAN
MniPolicyEntryValid(
  _In_ const MNI_POLICY_ENTRY* entry,
  _In_ UINT64 now,
  _In_ UINT64 policyExpiry)
{
  return !MniBytesAreZero(entry->ProcessIdentitySha256, MNI_SHA256_BYTES) &&
    (entry->EndpointKind == MNI_ENDPOINT_BROKER ||
     entry->EndpointKind == MNI_ENDPOINT_EGRESS_SUPERVISOR) &&
    (entry->AddressFamily == MNI_ADDRESS_FAMILY_IPV4 ||
     entry->AddressFamily == MNI_ADDRESS_FAMILY_IPV6) &&
    (entry->IpProtocol == MNI_IP_PROTOCOL_TCP ||
     entry->IpProtocol == MNI_IP_PROTOCOL_UDP) &&
    entry->RemotePort != 0 &&
    entry->Reserved == 0 &&
    entry->ExpiresAtFileTime100ns > now &&
    entry->ExpiresAtFileTime100ns <= policyExpiry &&
    MniAddressIsCanonical(entry);
}

static VOID
MniFreePolicySnapshot(_In_opt_ PMNI_POLICY_SNAPSHOT policy)
{
  SIZE_T size;

  if (policy == NULL) {
    return;
  }
  size = FIELD_OFFSET(MNI_POLICY_SNAPSHOT, Entries) +
    ((SIZE_T)policy->EntryCount * sizeof(MNI_POLICY_ENTRY));
  RtlSecureZeroMemory(policy, size);
  ExFreePoolWithTag(policy, MNI_POOL_TAG_POLICY);
}

static VOID
MniFreeProcessSnapshot(_In_opt_ PMNI_PROCESS_SNAPSHOT processes)
{
  SIZE_T size;
  ULONG index;

  if (processes == NULL) {
    return;
  }
  for (index = 0; index < processes->Count; ++index) {
    if (processes->Records[index].Process != NULL) {
      ObDereferenceObject(processes->Records[index].Process);
      processes->Records[index].Process = NULL;
    }
  }
  size = FIELD_OFFSET(MNI_PROCESS_SNAPSHOT, Records) +
    ((SIZE_T)processes->Count * sizeof(MNI_PROCESS_RECORD));
  RtlSecureZeroMemory(processes, size);
  ExFreePoolWithTag(processes, MNI_POOL_TAG_PROCESS);
}

PMNI_POLICY_SNAPSHOT
MniAcquirePolicy(VOID)
{
  PMNI_POLICY_SNAPSHOT policy;
  KIRQL oldIrql;

  KeAcquireSpinLock(&g_Mni.PolicyPointerLock, &oldIrql);
  policy = g_Mni.Policy;
  if (policy != NULL && !ExAcquireRundownProtection(&policy->Rundown)) {
    policy = NULL;
  }
  KeReleaseSpinLock(&g_Mni.PolicyPointerLock, oldIrql);
  return policy;
}

VOID
MniReleasePolicy(_In_opt_ PMNI_POLICY_SNAPSHOT policy)
{
  if (policy != NULL) {
    ExReleaseRundownProtection(&policy->Rundown);
  }
}

PMNI_PROCESS_SNAPSHOT
MniAcquireProcesses(VOID)
{
  PMNI_PROCESS_SNAPSHOT processes;
  KIRQL oldIrql;

  KeAcquireSpinLock(&g_Mni.ProcessPointerLock, &oldIrql);
  processes = g_Mni.Processes;
  if (processes != NULL && !ExAcquireRundownProtection(&processes->Rundown)) {
    processes = NULL;
  }
  KeReleaseSpinLock(&g_Mni.ProcessPointerLock, oldIrql);
  return processes;
}

VOID
MniReleaseProcesses(_In_opt_ PMNI_PROCESS_SNAPSHOT processes)
{
  if (processes != NULL) {
    ExReleaseRundownProtection(&processes->Rundown);
  }
}

static PMNI_POLICY_SNAPSHOT
MniSwapPolicy(_In_opt_ PMNI_POLICY_SNAPSHOT replacement)
{
  PMNI_POLICY_SNAPSHOT previous;
  KIRQL oldIrql;

  KeAcquireSpinLock(&g_Mni.PolicyPointerLock, &oldIrql);
  previous = g_Mni.Policy;
  g_Mni.Policy = replacement;
  KeReleaseSpinLock(&g_Mni.PolicyPointerLock, oldIrql);
  return previous;
}

static PMNI_PROCESS_SNAPSHOT
MniSwapProcesses(_In_opt_ PMNI_PROCESS_SNAPSHOT replacement)
{
  PMNI_PROCESS_SNAPSHOT previous;
  KIRQL oldIrql;

  KeAcquireSpinLock(&g_Mni.ProcessPointerLock, &oldIrql);
  previous = g_Mni.Processes;
  g_Mni.Processes = replacement;
  KeReleaseSpinLock(&g_Mni.ProcessPointerLock, oldIrql);
  return previous;
}

VOID
MniDestroyAllPolicy(VOID)
{
  PMNI_POLICY_SNAPSHOT policy;
  PMNI_PROCESS_SNAPSHOT processes;

  InterlockedExchange(&g_Mni.KillActive, 1);
  policy = MniSwapPolicy(NULL);
  processes = MniSwapProcesses(NULL);
  if (policy != NULL) {
    ExWaitForRundownProtectionRelease(&policy->Rundown);
    MniFreePolicySnapshot(policy);
  }
  if (processes != NULL) {
    ExWaitForRundownProtectionRelease(&processes->Rundown);
    MniFreeProcessSnapshot(processes);
  }
}

_IRQL_requires_max_(PASSIVE_LEVEL)
NTSTATUS
MniReplacePolicy(
  _In_reads_bytes_(inputLength) const MNI_POLICY_REPLACE_REQUEST* request,
  _In_ ULONG inputLength,
  _Out_ MNI_MUTATION_RESPONSE* response)
{
  PMNI_POLICY_SNAPSHOT replacement = NULL;
  PMNI_POLICY_SNAPSHOT previous;
  SIZE_T allocationSize;
  ULONG expectedSize;
  ULONG protocolStatus;
  ULONG index;
  UINT64 now;
  UCHAR digest[MNI_SHA256_BYTES] = { 0 };
  const UCHAR* hashBuffers[5];
  ULONG hashLengths[5];
  NTSTATUS status = STATUS_SUCCESS;

  PAGED_CODE();
  ExAcquireFastMutex(&g_Mni.MutationMutex);

  if (request == NULL || response == NULL ||
      inputLength < MNI_POLICY_REPLACE_BASE_SIZE ||
      request->EntryCount > MNI_MAX_POLICY_ENTRIES ||
      request->EntryCount >
        (MNI_MAX_FRAME_BYTES - MNI_POLICY_REPLACE_BASE_SIZE) / sizeof(MNI_POLICY_ENTRY)) {
    if (response != NULL && request != NULL) {
      MniFillMutationResponse(response, &request->Header, MNI_STATUS_INVALID_FRAME,
        STATUS_INVALID_BUFFER_SIZE);
    }
    status = STATUS_INVALID_BUFFER_SIZE;
    goto Exit;
  }
  expectedSize = MNI_POLICY_REPLACE_BASE_SIZE +
    request->EntryCount * sizeof(MNI_POLICY_ENTRY);
  protocolStatus = MniValidateMutationHeaderLocked(
    &request->Header,
    expectedSize,
    MNI_MESSAGE_POLICY_REPLACE_REQUEST,
    TRUE);
  if (inputLength != expectedSize || request->Reserved != 0) {
    protocolStatus = MNI_STATUS_INVALID_FRAME;
  }
  if (protocolStatus != MNI_STATUS_OK) {
    MniFillMutationResponse(response, &request->Header, protocolStatus, STATUS_ACCESS_DENIED);
    goto Exit;
  }

  now = MniSystemTime100ns();
  if (request->ExpiresAtFileTime100ns <= now ||
      request->ExpiresAtFileTime100ns - now > MNI_MAX_POLICY_LIFETIME_100NS ||
      MniBytesAreZero(request->PolicySha256, MNI_SHA256_BYTES)) {
    MniFillMutationResponse(response, &request->Header, MNI_STATUS_POLICY_INVALID,
      STATUS_INVALID_PARAMETER);
    goto Exit;
  }
  for (index = 0; index < request->EntryCount; ++index) {
    if (!MniPolicyEntryValid(
          &request->Entries[index],
          now,
          request->ExpiresAtFileTime100ns) ||
        (index != 0 && MniByteCompare(
          (const UCHAR*)&request->Entries[index - 1],
          (const UCHAR*)&request->Entries[index],
          sizeof(MNI_POLICY_ENTRY)) >= 0)) {
      MniFillMutationResponse(response, &request->Header, MNI_STATUS_POLICY_INVALID,
        STATUS_INVALID_PARAMETER);
      goto Exit;
    }
  }

  hashBuffers[0] = g_PolicyDomain;
  hashLengths[0] = sizeof(g_PolicyDomain) - 1;
  hashBuffers[1] = (const UCHAR*)&request->Header.PolicyGeneration;
  hashLengths[1] = sizeof(request->Header.PolicyGeneration);
  hashBuffers[2] = (const UCHAR*)&request->ExpiresAtFileTime100ns;
  hashLengths[2] = sizeof(request->ExpiresAtFileTime100ns);
  hashBuffers[3] = (const UCHAR*)&request->EntryCount;
  hashLengths[3] = sizeof(request->EntryCount);
  hashBuffers[4] = (const UCHAR*)request->Entries;
  hashLengths[4] = request->EntryCount * sizeof(MNI_POLICY_ENTRY);
  status = MniHashBuffers(hashBuffers, hashLengths, RTL_NUMBER_OF(hashBuffers), digest);
  if (!NT_SUCCESS(status) ||
      !MniBytesEqual(digest, request->PolicySha256, MNI_SHA256_BYTES)) {
    MniFillMutationResponse(response, &request->Header, MNI_STATUS_POLICY_INVALID, status);
    status = STATUS_SUCCESS;
    goto Exit;
  }

  allocationSize = FIELD_OFFSET(MNI_POLICY_SNAPSHOT, Entries) +
    ((SIZE_T)request->EntryCount * sizeof(MNI_POLICY_ENTRY));
  replacement = (PMNI_POLICY_SNAPSHOT)ExAllocatePool2(
    POOL_FLAG_NON_PAGED,
    allocationSize,
    MNI_POOL_TAG_POLICY);
  if (replacement == NULL) {
    MniFillMutationResponse(response, &request->Header, MNI_STATUS_INTERNAL_ERROR,
      STATUS_INSUFFICIENT_RESOURCES);
    status = STATUS_SUCCESS;
    goto Exit;
  }
  RtlZeroMemory(replacement, allocationSize);
  ExInitializeRundownProtection(&replacement->Rundown);
  replacement->Generation = request->Header.PolicyGeneration;
  replacement->ExpiresAtFileTime100ns = request->ExpiresAtFileTime100ns;
  replacement->EntryCount = request->EntryCount;
  RtlCopyMemory(replacement->Sha256, request->PolicySha256, MNI_SHA256_BYTES);
  if (request->EntryCount != 0) {
    RtlCopyMemory(
      replacement->Entries,
      request->Entries,
      request->EntryCount * sizeof(MNI_POLICY_ENTRY));
  }

  previous = MniSwapPolicy(replacement);
  replacement = NULL;
  MniCommitReplayLocked(&request->Header);
  InterlockedIncrement64(&g_Mni.Counters.PolicyReplacements);
  MniFillMutationResponse(response, &request->Header, MNI_STATUS_OK, STATUS_SUCCESS);
  if (previous != NULL) {
    ExWaitForRundownProtectionRelease(&previous->Rundown);
    MniFreePolicySnapshot(previous);
  }

Exit:
  if (replacement != NULL) {
    MniFreePolicySnapshot(replacement);
  }
  RtlSecureZeroMemory(digest, sizeof(digest));
  ExReleaseFastMutex(&g_Mni.MutationMutex);
  return status;
}

static NTSTATUS
MniValidateLiveProcess(
  _In_ const MNI_PROCESS_ENROLL_REQUEST* request,
  _Outptr_ PEPROCESS* process)
{
  PUNICODE_STRING liveImage = NULL;
  UNICODE_STRING requestedImage;
  NTSTATUS status;

  *process = NULL;
  if (request->ProcessId <= 4 || request->ProcessId > MAXULONG_PTR ||
      request->ProcessCreationTime100ns == 0 || request->ProcessStartKey == 0 ||
      !MniNormalizedImagePathValid(
        request->NormalizedImageNtPath,
        request->ImagePathChars) ||
      !MniNormalizedAppIdValid(request->NormalizedAppId, request->AppIdBytes) ||
      MniBytesAreZero(request->ImageSha256, MNI_SHA256_BYTES) ||
      MniBytesAreZero(request->ProcessIdentitySha256, MNI_SHA256_BYTES)) {
    return STATUS_INVALID_PARAMETER;
  }

  status = PsLookupProcessByProcessId((HANDLE)(ULONG_PTR)request->ProcessId, process);
  if (!NT_SUCCESS(status)) {
    return status;
  }
  if ((UINT64)PsGetProcessCreateTimeQuadPart(*process) !=
        request->ProcessCreationTime100ns ||
      PsGetProcessStartKey(*process) != request->ProcessStartKey ||
      PsGetProcessExitStatus(*process) != STATUS_PENDING) {
    status = STATUS_OBJECTID_EXISTS;
    goto Exit;
  }

  status = SeLocateProcessImageName(*process, &liveImage);
  if (!NT_SUCCESS(status) || liveImage == NULL) {
    goto Exit;
  }
  requestedImage.Buffer = (PWCH)request->NormalizedImageNtPath;
  requestedImage.Length = request->ImagePathChars * sizeof(WCHAR);
  requestedImage.MaximumLength = requestedImage.Length;
  if (!RtlEqualUnicodeString(&requestedImage, liveImage, TRUE)) {
    status = STATUS_OBJECT_NAME_MISMATCH;
  }

Exit:
  if (liveImage != NULL) {
    ExFreePool(liveImage);
  }
  if (!NT_SUCCESS(status) && *process != NULL) {
    ObDereferenceObject(*process);
    *process = NULL;
  }
  return status;
}

static BOOLEAN
MniLiveProcessObjectStillCurrent(
  _In_ const MNI_PROCESS_ENROLL_REQUEST* request,
  _In_ PEPROCESS expectedProcess)
{
  PEPROCESS currentProcess = NULL;
  BOOLEAN matches = FALSE;

  if (NT_SUCCESS(PsLookupProcessByProcessId(
        (HANDLE)(ULONG_PTR)request->ProcessId,
        &currentProcess))) {
    matches = currentProcess == expectedProcess &&
      (UINT64)PsGetProcessCreateTimeQuadPart(currentProcess) ==
        request->ProcessCreationTime100ns &&
      PsGetProcessStartKey(currentProcess) == request->ProcessStartKey &&
      PsGetProcessExitStatus(currentProcess) == STATUS_PENDING;
    ObDereferenceObject(currentProcess);
  }
  return matches;
}

static NTSTATUS
MniValidateProcessIdentityDigest(_In_ const MNI_PROCESS_ENROLL_REQUEST* request)
{
  const UCHAR* buffers[9];
  ULONG lengths[9];
  UCHAR digest[MNI_SHA256_BYTES];
  NTSTATUS status;

  buffers[0] = g_ProcessIdentityDomain;
  lengths[0] = sizeof(g_ProcessIdentityDomain) - 1;
  buffers[1] = (const UCHAR*)&request->ProcessId;
  lengths[1] = sizeof(request->ProcessId);
  buffers[2] = (const UCHAR*)&request->ProcessCreationTime100ns;
  lengths[2] = sizeof(request->ProcessCreationTime100ns);
  buffers[3] = (const UCHAR*)&request->ProcessStartKey;
  lengths[3] = sizeof(request->ProcessStartKey);
  buffers[4] = request->ImageSha256;
  lengths[4] = MNI_SHA256_BYTES;
  buffers[5] = (const UCHAR*)&request->ImagePathChars;
  lengths[5] = sizeof(request->ImagePathChars);
  buffers[6] = (const UCHAR*)request->NormalizedImageNtPath;
  lengths[6] = request->ImagePathChars * sizeof(USHORT);
  buffers[7] = (const UCHAR*)&request->AppIdBytes;
  lengths[7] = sizeof(request->AppIdBytes);
  buffers[8] = request->NormalizedAppId;
  lengths[8] = request->AppIdBytes;

  status = MniHashBuffers(buffers, lengths, RTL_NUMBER_OF(buffers), digest);
  if (NT_SUCCESS(status) &&
      !MniBytesEqual(digest, request->ProcessIdentitySha256, MNI_SHA256_BYTES)) {
    status = STATUS_DATA_ERROR;
  }
  RtlSecureZeroMemory(digest, sizeof(digest));
  return status;
}

static PMNI_PROCESS_SNAPSHOT
MniCloneProcessesForEnrollment(
  _In_opt_ PMNI_PROCESS_SNAPSHOT current,
  _In_ const MNI_PROCESS_ENROLL_REQUEST* request,
  _In_ PEPROCESS process)
{
  PMNI_PROCESS_SNAPSHOT replacement;
  ULONG currentCount = current == NULL ? 0 : current->Count;
  ULONG replacementCount = currentCount;
  ULONG index;
  ULONG outputIndex = 0;
  BOOLEAN replacing = FALSE;
  SIZE_T size;

  for (index = 0; index < currentCount; ++index) {
    if (current->Records[index].ProcessId == request->ProcessId) {
      replacing = TRUE;
      break;
    }
  }
  if (!replacing) {
    if (currentCount >= MNI_MAX_ENROLLED_PROCESSES) {
      return NULL;
    }
    replacementCount += 1;
  }
  size = FIELD_OFFSET(MNI_PROCESS_SNAPSHOT, Records) +
    ((SIZE_T)replacementCount * sizeof(MNI_PROCESS_RECORD));
  replacement = (PMNI_PROCESS_SNAPSHOT)ExAllocatePool2(
    POOL_FLAG_NON_PAGED,
    size,
    MNI_POOL_TAG_PROCESS);
  if (replacement == NULL) {
    return NULL;
  }
  RtlZeroMemory(replacement, size);
  ExInitializeRundownProtection(&replacement->Rundown);
  replacement->Count = replacementCount;

  for (index = 0; index < currentCount; ++index) {
    if (current->Records[index].ProcessId == request->ProcessId) {
      continue;
    }
    replacement->Records[outputIndex] = current->Records[index];
    ObReferenceObject(replacement->Records[outputIndex].Process);
    outputIndex += 1;
  }

  replacement->Records[outputIndex].ProcessId = request->ProcessId;
  replacement->Records[outputIndex].ProcessCreationTime100ns =
    request->ProcessCreationTime100ns;
  replacement->Records[outputIndex].ProcessStartKey = request->ProcessStartKey;
  replacement->Records[outputIndex].PolicyGeneration = request->Header.PolicyGeneration;
  replacement->Records[outputIndex].ExpiresAtFileTime100ns = request->ExpiresAtFileTime100ns;
  replacement->Records[outputIndex].ImagePathChars = request->ImagePathChars;
  replacement->Records[outputIndex].AppIdBytes = request->AppIdBytes;
  replacement->Records[outputIndex].Process = process;
  /* The published record remains fail-closed until a post-publication lookup
   * proves no exit/PID-reuse notification was missed before the swap. */
  replacement->Records[outputIndex].StalePid = 2;
  RtlCopyMemory(
    replacement->Records[outputIndex].ImageSha256,
    request->ImageSha256,
    MNI_SHA256_BYTES);
  RtlCopyMemory(
    replacement->Records[outputIndex].ProcessIdentitySha256,
    request->ProcessIdentitySha256,
    MNI_SHA256_BYTES);
  RtlCopyMemory(
    replacement->Records[outputIndex].NormalizedImageNtPath,
    request->NormalizedImageNtPath,
    (request->ImagePathChars + 1) * sizeof(USHORT));
  RtlCopyMemory(
    replacement->Records[outputIndex].NormalizedAppId,
    request->NormalizedAppId,
    request->AppIdBytes);
  return replacement;
}

_IRQL_requires_max_(PASSIVE_LEVEL)
NTSTATUS
MniEnrollProcess(
  _In_ const MNI_PROCESS_ENROLL_REQUEST* request,
  _Out_ MNI_MUTATION_RESPONSE* response)
{
  PMNI_PROCESS_SNAPSHOT current = NULL;
  PMNI_PROCESS_SNAPSHOT replacement = NULL;
  PMNI_PROCESS_SNAPSHOT previous;
  PMNI_PROCESS_SNAPSHOT rejected;
  PMNI_PROCESS_RECORD enrolledRecord;
  PMNI_POLICY_SNAPSHOT policy = NULL;
  PEPROCESS process = NULL;
  ULONG protocolStatus;
  ULONG index;
  UINT64 now;
  NTSTATUS status;

  PAGED_CODE();
  ExAcquireFastMutex(&g_Mni.MutationMutex);
  protocolStatus = MniValidateMutationHeaderLocked(
    &request->Header,
    sizeof(*request),
    MNI_MESSAGE_PROCESS_ENROLL_REQUEST,
    FALSE);
  if (request->Reserved != 0) {
    protocolStatus = MNI_STATUS_INVALID_FRAME;
  }
  if (protocolStatus != MNI_STATUS_OK) {
    MniFillMutationResponse(response, &request->Header, protocolStatus, STATUS_ACCESS_DENIED);
    status = STATUS_SUCCESS;
    goto Exit;
  }

  now = MniSystemTime100ns();
  policy = MniAcquirePolicy();
  if (policy == NULL || policy->Generation != request->Header.PolicyGeneration ||
      policy->ExpiresAtFileTime100ns <= now ||
      request->ExpiresAtFileTime100ns <= now ||
      request->ExpiresAtFileTime100ns > policy->ExpiresAtFileTime100ns) {
    MniFillMutationResponse(response, &request->Header, MNI_STATUS_STALE_GENERATION,
      STATUS_INVALID_DEVICE_STATE);
    status = STATUS_SUCCESS;
    goto Exit;
  }

  status = MniValidateLiveProcess(request, &process);
  if (!NT_SUCCESS(status)) {
    MniFillMutationResponse(response, &request->Header,
      status == STATUS_INVALID_PARAMETER ? MNI_STATUS_PROCESS_IDENTITY_MISMATCH :
        MNI_STATUS_PROCESS_NOT_FOUND,
      status);
    status = STATUS_SUCCESS;
    goto Exit;
  }
  status = MniValidateProcessIdentityDigest(request);
  if (!NT_SUCCESS(status)) {
    MniFillMutationResponse(response, &request->Header,
      MNI_STATUS_PROCESS_IDENTITY_MISMATCH, status);
    status = STATUS_SUCCESS;
    goto Exit;
  }

  current = MniAcquireProcesses();
  replacement = MniCloneProcessesForEnrollment(current, request, process);
  if (replacement == NULL) {
    MniFillMutationResponse(response, &request->Header, MNI_STATUS_CAPACITY,
      STATUS_INSUFFICIENT_RESOURCES);
    status = STATUS_SUCCESS;
    goto Exit;
  }
  process = NULL; /* Ownership transferred to the replacement snapshot. */
  MniReleaseProcesses(current);
  current = NULL;

  previous = MniSwapProcesses(replacement);
  enrolledRecord = NULL;
  for (index = 0; index < replacement->Count; ++index) {
    if (replacement->Records[index].ProcessId == request->ProcessId) {
      enrolledRecord = &replacement->Records[index];
      break;
    }
  }
  if (enrolledRecord == NULL ||
      !MniLiveProcessObjectStillCurrent(request, enrolledRecord->Process) ||
      InterlockedCompareExchange(&enrolledRecord->StalePid, 0, 2) != 2) {
    if (enrolledRecord != NULL) {
      InterlockedExchange(&enrolledRecord->StalePid, 1);
    }
    rejected = MniSwapProcesses(previous);
    previous = NULL;
    if (rejected != NULL) {
      ExWaitForRundownProtectionRelease(&rejected->Rundown);
      MniFreeProcessSnapshot(rejected);
    }
    replacement = NULL;
    MniFillMutationResponse(response, &request->Header,
      MNI_STATUS_PROCESS_IDENTITY_MISMATCH, STATUS_OBJECTID_EXISTS);
    status = STATUS_SUCCESS;
    goto Exit;
  }
  replacement = NULL;
  MniCommitReplayLocked(&request->Header);
  InterlockedIncrement64(&g_Mni.Counters.EnrollmentMutations);
  MniFillMutationResponse(response, &request->Header, MNI_STATUS_OK, STATUS_SUCCESS);
  if (previous != NULL) {
    ExWaitForRundownProtectionRelease(&previous->Rundown);
    MniFreeProcessSnapshot(previous);
  }
  status = STATUS_SUCCESS;

Exit:
  MniReleasePolicy(policy);
  MniReleaseProcesses(current);
  if (process != NULL) {
    ObDereferenceObject(process);
  }
  if (replacement != NULL) {
    MniFreeProcessSnapshot(replacement);
  }
  ExReleaseFastMutex(&g_Mni.MutationMutex);
  return status;
}

_IRQL_requires_max_(PASSIVE_LEVEL)
NTSTATUS
MniRemoveProcess(
  _In_ const MNI_PROCESS_REMOVE_REQUEST* request,
  _Out_ MNI_MUTATION_RESPONSE* response)
{
  PMNI_PROCESS_SNAPSHOT current = NULL;
  PMNI_PROCESS_SNAPSHOT replacement = NULL;
  PMNI_PROCESS_SNAPSHOT previous;
  ULONG protocolStatus;
  ULONG index;
  ULONG outputIndex = 0;
  ULONG found = 0;
  BOOLEAN processTerminal = FALSE;
  SIZE_T size;
  NTSTATUS status = STATUS_SUCCESS;

  PAGED_CODE();
  ExAcquireFastMutex(&g_Mni.MutationMutex);
  protocolStatus = MniValidateMutationHeaderLocked(
    &request->Header,
    sizeof(*request),
    MNI_MESSAGE_PROCESS_REMOVE_REQUEST,
    FALSE);
  if (protocolStatus != MNI_STATUS_OK) {
    MniFillMutationResponse(response, &request->Header, protocolStatus, STATUS_ACCESS_DENIED);
    goto Exit;
  }
  current = MniAcquireProcesses();
  if (current == NULL) {
    MniFillMutationResponse(response, &request->Header, MNI_STATUS_PROCESS_NOT_FOUND,
      STATUS_NOT_FOUND);
    goto Exit;
  }
  for (index = 0; index < current->Count; ++index) {
    if (current->Records[index].ProcessId == request->ProcessId &&
        MniBytesEqual(
          current->Records[index].ProcessIdentitySha256,
          request->ProcessIdentitySha256,
          MNI_SHA256_BYTES)) {
      found += 1;
      processTerminal =
        InterlockedCompareExchange(&current->Records[index].Terminated, 0, 0) != 0 ||
        PsGetProcessExitStatus(current->Records[index].Process) != STATUS_PENDING;
    }
  }
  if (found != 1) {
    MniFillMutationResponse(response, &request->Header, MNI_STATUS_PROCESS_NOT_FOUND,
      STATUS_NOT_FOUND);
    goto Exit;
  }
  if (!processTerminal) {
    MniFillMutationResponse(response, &request->Header, MNI_STATUS_ACCESS_DENIED,
      STATUS_ACCESS_DENIED);
    goto Exit;
  }

  size = FIELD_OFFSET(MNI_PROCESS_SNAPSHOT, Records) +
    ((SIZE_T)(current->Count - 1) * sizeof(MNI_PROCESS_RECORD));
  replacement = (PMNI_PROCESS_SNAPSHOT)ExAllocatePool2(
    POOL_FLAG_NON_PAGED,
    size,
    MNI_POOL_TAG_PROCESS);
  if (replacement == NULL) {
    MniFillMutationResponse(response, &request->Header, MNI_STATUS_INTERNAL_ERROR,
      STATUS_INSUFFICIENT_RESOURCES);
    goto Exit;
  }
  RtlZeroMemory(replacement, size);
  ExInitializeRundownProtection(&replacement->Rundown);
  replacement->Count = current->Count - 1;
  for (index = 0; index < current->Count; ++index) {
    if (current->Records[index].ProcessId == request->ProcessId) {
      continue;
    }
    replacement->Records[outputIndex] = current->Records[index];
    ObReferenceObject(replacement->Records[outputIndex].Process);
    outputIndex += 1;
  }
  MniReleaseProcesses(current);
  current = NULL;

  previous = MniSwapProcesses(replacement);
  replacement = NULL;
  MniCommitReplayLocked(&request->Header);
  InterlockedIncrement64(&g_Mni.Counters.EnrollmentMutations);
  MniFillMutationResponse(response, &request->Header, MNI_STATUS_OK, STATUS_SUCCESS);
  if (previous != NULL) {
    ExWaitForRundownProtectionRelease(&previous->Rundown);
    MniFreeProcessSnapshot(previous);
  }

Exit:
  MniReleaseProcesses(current);
  if (replacement != NULL) {
    MniFreeProcessSnapshot(replacement);
  }
  ExReleaseFastMutex(&g_Mni.MutationMutex);
  return status;
}

_IRQL_requires_max_(PASSIVE_LEVEL)
NTSTATUS
MniSetKillState(
  _In_ const MNI_KILL_REQUEST* request,
  _Out_ MNI_MUTATION_RESPONSE* response)
{
  ULONG protocolStatus;
  NTSTATUS status = STATUS_SUCCESS;

  PAGED_CODE();
  ExAcquireFastMutex(&g_Mni.MutationMutex);
  protocolStatus = MniValidateMutationHeaderLocked(
    &request->Header,
    sizeof(*request),
    MNI_MESSAGE_KILL_REQUEST,
    FALSE);
  if (request->Reserved != 0 || request->ReasonCode == 0 ||
      request->KillGeneration == 0 ||
      request->KillGeneration <= (UINT64)InterlockedCompareExchange64(
        &g_Mni.KillGeneration, 0, 0)) {
    protocolStatus = MNI_STATUS_INVALID_FRAME;
  }
  if (protocolStatus != MNI_STATUS_OK) {
    MniFillMutationResponse(response, &request->Header, protocolStatus, STATUS_ACCESS_DENIED);
    goto Exit;
  }

  InterlockedExchange64(&g_Mni.KillGeneration, (LONG64)request->KillGeneration);
  InterlockedExchange(&g_Mni.KillActive, 1);
  MniCommitReplayLocked(&request->Header);
  MniFillMutationResponse(response, &request->Header, MNI_STATUS_OK, STATUS_SUCCESS);

Exit:
  ExReleaseFastMutex(&g_Mni.MutationMutex);
  return status;
}

static BOOLEAN
MniAddressMatches(
  _In_ const MNI_POLICY_ENTRY* entry,
  _In_reads_(16) const UCHAR remoteAddress[16])
{
  ULONG addressBytes = entry->AddressFamily == MNI_ADDRESS_FAMILY_IPV4 ? 4u : 16u;
  ULONG fullBytes = entry->PrefixLength / 8;
  ULONG remainingBits = entry->PrefixLength % 8;

  if (fullBytes != 0 &&
      !MniBytesEqual(entry->RemoteAddress, remoteAddress, fullBytes)) {
    return FALSE;
  }
  if (remainingBits != 0) {
    UCHAR mask = (UCHAR)(0xffu << (8 - remainingBits));
    if ((entry->RemoteAddress[fullBytes] & mask) !=
        (remoteAddress[fullBytes] & mask)) {
      return FALSE;
    }
  }
  if (addressBytes == 4 &&
      !MniBytesAreZero(remoteAddress + 4, 12)) {
    return FALSE;
  }
  return TRUE;
}

_IRQL_requires_max_(DISPATCH_LEVEL)
BOOLEAN
MniClassifyConnect(
  _In_ UINT64 processId,
  _In_reads_bytes_opt_(appIdBytes) const UCHAR* appId,
  _In_ USHORT appIdBytes,
  _In_ UCHAR addressFamily,
  _In_ UCHAR protocol,
  _In_ USHORT remotePort,
  _In_reads_(16) const UCHAR remoteAddress[16])
{
  PMNI_PROCESS_SNAPSHOT processes;
  PMNI_POLICY_SNAPSHOT policy;
  PMNI_PROCESS_RECORD process = NULL;
  UINT64 now;
  ULONG index;
  BOOLEAN allowed = FALSE;

  InterlockedIncrement64(&g_Mni.Counters.ConnectsInspected);
  processes = MniAcquireProcesses();
  if (processes == NULL) {
    return TRUE;
  }
  for (index = 0; index < processes->Count; ++index) {
    if (processes->Records[index].ProcessId == processId) {
      process = &processes->Records[index];
      break;
    }
  }
  if (process == NULL) {
    MniReleaseProcesses(processes);
    return TRUE; /* Only explicitly enrolled identities are governed. */
  }

  if (InterlockedCompareExchange(&process->Terminated, 0, 0) != 0 ||
      InterlockedCompareExchange(&process->StalePid, 0, 0) != 0) {
    InterlockedIncrement64(&g_Mni.Counters.ConnectsBlockedPidReuse);
    MniReleaseProcesses(processes);
    return FALSE;
  }
  if (appId == NULL || appIdBytes != process->AppIdBytes ||
      !MniBytesEqual(appId, process->NormalizedAppId, appIdBytes)) {
    InterlockedIncrement64(&g_Mni.Counters.ConnectsBlockedAppIdentity);
    MniReleaseProcesses(processes);
    return FALSE;
  }
  if (InterlockedCompareExchange(&g_Mni.KillActive, 0, 0) != 0) {
    InterlockedIncrement64(&g_Mni.Counters.ConnectsBlockedKill);
    MniReleaseProcesses(processes);
    return FALSE;
  }

  now = MniSystemTime100ns();
  if (process->ExpiresAtFileTime100ns <= now) {
    InterlockedIncrement64(&g_Mni.Counters.ConnectsBlockedExpired);
    MniReleaseProcesses(processes);
    return FALSE;
  }
  policy = MniAcquirePolicy();
  if (policy == NULL || policy->Generation != process->PolicyGeneration) {
    InterlockedIncrement64(&g_Mni.Counters.ConnectsBlockedNoPolicy);
    MniReleasePolicy(policy);
    MniReleaseProcesses(processes);
    return FALSE;
  }
  if (policy->ExpiresAtFileTime100ns <= now) {
    InterlockedIncrement64(&g_Mni.Counters.ConnectsBlockedExpired);
    MniReleasePolicy(policy);
    MniReleaseProcesses(processes);
    return FALSE;
  }

  for (index = 0; index < policy->EntryCount; ++index) {
    const MNI_POLICY_ENTRY* entry = &policy->Entries[index];
    if (entry->ExpiresAtFileTime100ns > now &&
        entry->AddressFamily == addressFamily &&
        entry->IpProtocol == protocol &&
        entry->RemotePort == remotePort &&
        MniBytesEqual(
          entry->ProcessIdentitySha256,
          process->ProcessIdentitySha256,
          MNI_SHA256_BYTES) &&
        MniAddressMatches(entry, remoteAddress)) {
      allowed = TRUE;
      break;
    }
  }
  if (allowed) {
    InterlockedIncrement64(&g_Mni.Counters.ConnectsPermitted);
  } else {
    InterlockedIncrement64(&g_Mni.Counters.ConnectsBlockedDestination);
  }
  MniReleasePolicy(policy);
  MniReleaseProcesses(processes);
  return allowed;
}

_IRQL_requires_max_(PASSIVE_LEVEL)
VOID
MniProcessNotify(
  _Inout_ PEPROCESS process,
  _In_ HANDLE processId,
  _Inout_opt_ PPS_CREATE_NOTIFY_INFO createInfo)
{
  PMNI_PROCESS_SNAPSHOT processes;
  UINT64 id = (UINT64)(ULONG_PTR)processId;
  ULONG index;

  PAGED_CODE();
  processes = MniAcquireProcesses();
  if (processes == NULL) {
    return;
  }
  for (index = 0; index < processes->Count; ++index) {
    PMNI_PROCESS_RECORD record = &processes->Records[index];
    if (record->ProcessId != id) {
      continue;
    }
    if (createInfo == NULL && record->Process == process) {
      InterlockedExchange(&record->Terminated, 1);
    } else if (createInfo != NULL && record->Process != process) {
      InterlockedExchange(&record->StalePid, 1);
    }
  }
  MniReleaseProcesses(processes);
}

_IRQL_requires_max_(PASSIVE_LEVEL)
NTSTATUS
MniGetHealth(
  _In_ const MNI_HEALTH_REQUEST* request,
  _Out_ MNI_HEALTH_RESPONSE* response)
{
  PMNI_POLICY_SNAPSHOT policy;
  PMNI_PROCESS_SNAPSHOT processes;
  const UCHAR* hashBuffers[3];
  ULONG hashLengths[3];
  NTSTATUS status;

  PAGED_CODE();
  if (!MniHeaderShapeValid(
        &request->Header,
        sizeof(*request),
        MNI_MESSAGE_HEALTH_REQUEST) ||
      !MniBytesEqual(request->Header.BootId, g_Mni.BootId, MNI_UUID_BYTES) ||
      request->Header.RequestSequence != 0 ||
      request->Header.PolicyGeneration != 0 ||
      MniBytesAreZero(request->Header.RequestId, MNI_UUID_BYTES) ||
      MniBytesAreZero(request->ChallengeNonce, MNI_SHA256_BYTES)) {
    return STATUS_INVALID_PARAMETER;
  }

  RtlZeroMemory(response, sizeof(*response));
  MniFillResponseHeader(
    &response->Header,
    MNI_MESSAGE_HEALTH_RESPONSE,
    sizeof(*response),
    &request->Header);
  response->Status = MNI_STATUS_OK;
  response->BootTimeFileTime100ns = g_Mni.BootTimeFileTime100ns;
  response->KillGeneration =
    (UINT64)InterlockedCompareExchange64(&g_Mni.KillGeneration, 0, 0);
  response->LastAcceptedRequestSequence =
    (UINT64)InterlockedCompareExchange64(&g_Mni.LastRequestSequence, 0, 0);
  if (InterlockedCompareExchange(&g_Mni.WfpRegistered, 0, 0) != 0) {
    response->HealthFlags |= MNI_HEALTH_WFP_REGISTERED;
  }
  if (InterlockedCompareExchange(&g_Mni.KillActive, 0, 0) != 0) {
    response->HealthFlags |= MNI_HEALTH_KILL_ACTIVE;
  }
  if (InterlockedCompareExchange(&g_Mni.Unloading, 0, 0) != 0) {
    response->HealthFlags |= MNI_HEALTH_UNLOADING;
  }
  if (!MniBytesAreZero(g_Mni.DriverImageSha256, MNI_SHA256_BYTES)) {
    response->HealthFlags |= MNI_HEALTH_DRIVER_MEASUREMENT_PROVISIONED;
  }
  if (!MniBytesAreZero(g_Mni.BootMeasurementSha256, MNI_SHA256_BYTES)) {
    response->HealthFlags |= MNI_HEALTH_BOOT_MEASUREMENT_PROVISIONED;
  }
  RtlCopyMemory(
    response->BootMeasurementSha256,
    g_Mni.BootMeasurementSha256,
    MNI_SHA256_BYTES);
  RtlCopyMemory(
    response->DriverImageSha256,
    g_Mni.DriverImageSha256,
    MNI_SHA256_BYTES);

  policy = MniAcquirePolicy();
  if (policy != NULL) {
    response->HealthFlags |= MNI_HEALTH_POLICY_ACTIVE;
    response->CurrentPolicyGeneration = policy->Generation;
    response->PolicyExpiresAtFileTime100ns = policy->ExpiresAtFileTime100ns;
    response->PolicyEntryCount = policy->EntryCount;
    RtlCopyMemory(
      response->CurrentPolicySha256,
      policy->Sha256,
      MNI_SHA256_BYTES);
  }
  processes = MniAcquireProcesses();
  if (processes != NULL) {
    response->EnrolledProcessCount = processes->Count;
  }
  response->CalloutIdV4 = g_Mni.CalloutIdV4;
  response->CalloutIdV6 = g_Mni.CalloutIdV6;

#define MNI_COPY_COUNTER(name) \
  response->Counters.name = (UINT64)InterlockedCompareExchange64( \
    &g_Mni.Counters.name, 0, 0)
  MNI_COPY_COUNTER(ConnectsInspected);
  MNI_COPY_COUNTER(ConnectsPermitted);
  MNI_COPY_COUNTER(ConnectsBlockedNoPolicy);
  MNI_COPY_COUNTER(ConnectsBlockedKill);
  MNI_COPY_COUNTER(ConnectsBlockedExpired);
  MNI_COPY_COUNTER(ConnectsBlockedPidReuse);
  MNI_COPY_COUNTER(ConnectsBlockedAppIdentity);
  MNI_COPY_COUNTER(ConnectsBlockedDestination);
  MNI_COPY_COUNTER(PolicyReplacements);
  MNI_COPY_COUNTER(EnrollmentMutations);
  MNI_COPY_COUNTER(ReplayRejections);
  MNI_COPY_COUNTER(InvalidIoctls);
#undef MNI_COPY_COUNTER

  hashBuffers[0] = g_HealthDomain;
  hashLengths[0] = sizeof(g_HealthDomain) - 1;
  hashBuffers[1] = request->ChallengeNonce;
  hashLengths[1] = MNI_SHA256_BYTES;
  hashBuffers[2] = (const UCHAR*)response;
  hashLengths[2] = FIELD_OFFSET(MNI_HEALTH_RESPONSE, ChallengeResponseSha256);
  status = MniHashBuffers(
    hashBuffers,
    hashLengths,
    RTL_NUMBER_OF(hashBuffers),
    response->ChallengeResponseSha256);
  MniReleaseProcesses(processes);
  MniReleasePolicy(policy);
  return status;
}

#pragma alloc_text(PAGE, MniReplacePolicy)
#pragma alloc_text(PAGE, MniEnrollProcess)
#pragma alloc_text(PAGE, MniRemoveProcess)
#pragma alloc_text(PAGE, MniSetKillState)
#pragma alloc_text(PAGE, MniProcessNotify)
#pragma alloc_text(PAGE, MniGetHealth)
