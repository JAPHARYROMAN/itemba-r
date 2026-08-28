#include "driver.h"

/*
 * These identifiers are private to the native network-enforcement component.
 * The dynamic WFP session owns every management-plane object, so closing the
 * engine handle removes the filters, callouts, sublayer, and provider after an
 * orderly unload or an unexpected driver teardown.
 */
static const GUID g_MniProviderKey =
  { 0x5a2e0ce1, 0x26fc, 0x47f2, { 0x86, 0xd2, 0x5a, 0x4f, 0xb2, 0x4a, 0xf1, 0x81 } };
static const GUID g_MniSublayerKey =
  { 0xba3e955c, 0x81d8, 0x4d5d, { 0x91, 0x9b, 0x74, 0x41, 0xa6, 0xaa, 0xe9, 0xa7 } };
static const GUID g_MniCalloutV4Key =
  { 0x3f8a48c4, 0x9205, 0x4b44, { 0x82, 0x13, 0x4e, 0x77, 0xb4, 0x6b, 0xc4, 0x0a } };
static const GUID g_MniCalloutV6Key =
  { 0xa584d0a0, 0x3ca9, 0x4a9d, { 0xa3, 0x04, 0x03, 0xc5, 0xd0, 0x24, 0x21, 0xf9 } };

static NTSTATUS
MniWfpManagementStatus(_In_ DWORD result)
{
  return result == ERROR_SUCCESS ? STATUS_SUCCESS : RtlNtStatusFromDosError(result);
}

static VOID NTAPI
MniClassifyCommon(
  _In_ const FWPS_INCOMING_VALUES0* fixedValues,
  _In_ const FWPS_INCOMING_METADATA_VALUES0* metadata,
  _In_ UINT16 protocolField,
  _In_ UINT16 addressField,
  _In_ UINT16 portField,
  _In_ UINT16 appIdField,
  _In_ UCHAR addressFamily,
  _Inout_ FWPS_CLASSIFY_OUT0* classifyOut)
{
  const FWP_BYTE_BLOB* appId = NULL;
  UCHAR remoteAddress[16] = { 0 };
  UINT64 processId;
  UCHAR protocol;
  USHORT remotePort;
  BOOLEAN allowed;
  BOOLEAN shapeValid = TRUE;

  if (classifyOut == NULL ||
      (classifyOut->rights & FWPS_RIGHT_ACTION_WRITE) == 0) {
    return;
  }

  /* ALE_AUTH_CONNECT supplies a stable originating PID and application ID. */
  if (fixedValues == NULL || metadata == NULL ||
      (metadata->currentMetadataValues & FWPS_METADATA_FIELD_PROCESS_ID) == 0) {
    classifyOut->actionType = FWP_ACTION_CONTINUE;
    return;
  }

  processId = metadata->processId;
  if (fixedValues->incomingValue == NULL ||
      fixedValues->valueCount <= protocolField ||
      fixedValues->valueCount <= addressField ||
      fixedValues->valueCount <= portField ||
      fixedValues->valueCount <= appIdField) {
    shapeValid = FALSE;
    protocol = 0;
    remotePort = 0;
    goto Classify;
  }
  if (fixedValues->incomingValue[protocolField].value.type != FWP_UINT8 ||
      fixedValues->incomingValue[portField].value.type != FWP_UINT16 ||
      fixedValues->incomingValue[appIdField].value.type != FWP_BYTE_BLOB_TYPE) {
    shapeValid = FALSE;
    protocol = 0;
    remotePort = 0;
  } else {
    protocol = fixedValues->incomingValue[protocolField].value.uint8;
    remotePort = fixedValues->incomingValue[portField].value.uint16;
    appId = fixedValues->incomingValue[appIdField].value.byteBlob;
  }

  if (addressFamily == MNI_ADDRESS_FAMILY_IPV4) {
    UINT32 address;
    if (fixedValues->incomingValue[addressField].value.type != FWP_UINT32) {
      shapeValid = FALSE;
    } else {
      /* WFP exposes the numeric IPv4 address in host order. The protocol stores
       * canonical network-order octets, independent of CPU endianness. */
      address = fixedValues->incomingValue[addressField].value.uint32;
      remoteAddress[0] = (UCHAR)(address >> 24);
      remoteAddress[1] = (UCHAR)(address >> 16);
      remoteAddress[2] = (UCHAR)(address >> 8);
      remoteAddress[3] = (UCHAR)address;
    }
  } else {
    const FWP_BYTE_ARRAY16* address;
    if (fixedValues->incomingValue[addressField].value.type != FWP_BYTE_ARRAY16_TYPE ||
        fixedValues->incomingValue[addressField].value.byteArray16 == NULL) {
      shapeValid = FALSE;
    } else {
      address = fixedValues->incomingValue[addressField].value.byteArray16;
      RtlCopyMemory(remoteAddress, address->byteArray16, sizeof(remoteAddress));
    }
  }

Classify:
  allowed = MniClassifyConnect(
    processId,
    !shapeValid || appId == NULL || appId->size > MAXUSHORT ? NULL : appId->data,
    !shapeValid || appId == NULL || appId->size > MAXUSHORT ? 0 : (USHORT)appId->size,
    addressFamily,
    protocol,
    remotePort,
    remoteAddress);
  if (!allowed) {
    classifyOut->actionType = FWP_ACTION_BLOCK;
    classifyOut->rights &= ~FWPS_RIGHT_ACTION_WRITE;
    return;
  }

  /* A permitted or unenrolled connection remains subject to the rest of the
   * Windows filtering pipeline. This callout never bypasses Windows Firewall. */
  classifyOut->actionType = FWP_ACTION_CONTINUE;
}

static VOID NTAPI
MniClassifyV4(
  _In_ const FWPS_INCOMING_VALUES0* fixedValues,
  _In_ const FWPS_INCOMING_METADATA_VALUES0* metadata,
  _Inout_opt_ VOID* layerData,
  _In_ const FWPS_FILTER0* filter,
  _In_ UINT64 flowContext,
  _Inout_ FWPS_CLASSIFY_OUT0* classifyOut)
{
  UNREFERENCED_PARAMETER(layerData);
  UNREFERENCED_PARAMETER(filter);
  UNREFERENCED_PARAMETER(flowContext);
  MniClassifyCommon(
    fixedValues,
    metadata,
    FWPS_FIELD_ALE_AUTH_CONNECT_V4_IP_PROTOCOL,
    FWPS_FIELD_ALE_AUTH_CONNECT_V4_IP_REMOTE_ADDRESS,
    FWPS_FIELD_ALE_AUTH_CONNECT_V4_IP_REMOTE_PORT,
    FWPS_FIELD_ALE_AUTH_CONNECT_V4_ALE_APP_ID,
    MNI_ADDRESS_FAMILY_IPV4,
    classifyOut);
}

static VOID NTAPI
MniClassifyV6(
  _In_ const FWPS_INCOMING_VALUES0* fixedValues,
  _In_ const FWPS_INCOMING_METADATA_VALUES0* metadata,
  _Inout_opt_ VOID* layerData,
  _In_ const FWPS_FILTER0* filter,
  _In_ UINT64 flowContext,
  _Inout_ FWPS_CLASSIFY_OUT0* classifyOut)
{
  UNREFERENCED_PARAMETER(layerData);
  UNREFERENCED_PARAMETER(filter);
  UNREFERENCED_PARAMETER(flowContext);
  MniClassifyCommon(
    fixedValues,
    metadata,
    FWPS_FIELD_ALE_AUTH_CONNECT_V6_IP_PROTOCOL,
    FWPS_FIELD_ALE_AUTH_CONNECT_V6_IP_REMOTE_ADDRESS,
    FWPS_FIELD_ALE_AUTH_CONNECT_V6_IP_REMOTE_PORT,
    FWPS_FIELD_ALE_AUTH_CONNECT_V6_ALE_APP_ID,
    MNI_ADDRESS_FAMILY_IPV6,
    classifyOut);
}

static NTSTATUS NTAPI
MniNotify(
  _In_ FWPS_CALLOUT_NOTIFY_TYPE notifyType,
  _In_ const GUID* filterKey,
  _Inout_ FWPS_FILTER0* filter)
{
  UNREFERENCED_PARAMETER(notifyType);
  UNREFERENCED_PARAMETER(filterKey);
  UNREFERENCED_PARAMETER(filter);
  return STATUS_SUCCESS;
}

static VOID NTAPI
MniFlowDelete(_In_ UINT16 layerId, _In_ UINT32 calloutId, _In_ UINT64 flowContext)
{
  UNREFERENCED_PARAMETER(layerId);
  UNREFERENCED_PARAMETER(calloutId);
  UNREFERENCED_PARAMETER(flowContext);
}

static NTSTATUS
MniRegisterRuntimeCallout(
  _In_ PDEVICE_OBJECT deviceObject,
  _In_ const GUID* key,
  _In_ FWPS_CALLOUT_CLASSIFY_FN0 classify,
  _Out_ UINT32* calloutId)
{
  FWPS_CALLOUT0 callout;

  RtlZeroMemory(&callout, sizeof(callout));
  callout.calloutKey = *key;
  callout.classifyFn = classify;
  callout.notifyFn = MniNotify;
  callout.flowDeleteFn = MniFlowDelete;
  return FwpsCalloutRegister0(deviceObject, &callout, calloutId);
}

static NTSTATUS
MniAddManagementCallout(
  _In_ HANDLE engine,
  _In_ const GUID* calloutKey,
  _In_ const GUID* layerKey,
  _In_ const WCHAR* name)
{
  FWPM_CALLOUT0 callout;

  RtlZeroMemory(&callout, sizeof(callout));
  callout.calloutKey = *calloutKey;
  callout.displayData.name = (PWSTR)name;
  callout.providerKey = (GUID*)&g_MniProviderKey;
  callout.applicableLayer = *layerKey;
  return MniWfpManagementStatus(FwpmCalloutAdd0(engine, &callout, NULL, NULL));
}

static NTSTATUS
MniAddFilter(
  _In_ HANDLE engine,
  _In_ const GUID* calloutKey,
  _In_ const GUID* layerKey,
  _In_ const WCHAR* name)
{
  FWPM_FILTER0 filter;

  RtlZeroMemory(&filter, sizeof(filter));
  filter.displayData.name = (PWSTR)name;
  filter.providerKey = (GUID*)&g_MniProviderKey;
  filter.layerKey = *layerKey;
  filter.subLayerKey = g_MniSublayerKey;
  filter.weight.type = FWP_EMPTY;
  filter.action.type = FWP_ACTION_CALLOUT_TERMINATING;
  filter.action.calloutKey = *calloutKey;
  filter.flags = FWPM_FILTER_FLAG_CLEAR_ACTION_RIGHT;
  return MniWfpManagementStatus(FwpmFilterAdd0(engine, &filter, NULL, NULL));
}

_IRQL_requires_max_(PASSIVE_LEVEL)
NTSTATUS
MniWfpStart(_In_ PDEVICE_OBJECT deviceObject)
{
  FWPM_SESSION0 session;
  FWPM_PROVIDER0 provider;
  FWPM_SUBLAYER0 sublayer;
  NTSTATUS status;
  BOOLEAN transactionOpen = FALSE;

  PAGED_CODE();
  status = MniRegisterRuntimeCallout(
    deviceObject, &g_MniCalloutV4Key, MniClassifyV4, &g_Mni.CalloutIdV4);
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }
  status = MniRegisterRuntimeCallout(
    deviceObject, &g_MniCalloutV6Key, MniClassifyV6, &g_Mni.CalloutIdV6);
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }

  RtlZeroMemory(&session, sizeof(session));
  session.displayData.name = L"Itemba Msaidizi network isolation";
  session.flags = FWPM_SESSION_FLAG_DYNAMIC;
  status = MniWfpManagementStatus(FwpmEngineOpen0(
    NULL,
    RPC_C_AUTHN_WINNT,
    NULL,
    &session,
    &g_Mni.WfpEngine));
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }
  status = MniWfpManagementStatus(FwpmTransactionBegin0(g_Mni.WfpEngine, 0));
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }
  transactionOpen = TRUE;

  RtlZeroMemory(&provider, sizeof(provider));
  provider.providerKey = g_MniProviderKey;
  provider.displayData.name = L"Itemba Msaidizi network isolation provider";
  status = MniWfpManagementStatus(FwpmProviderAdd0(
    g_Mni.WfpEngine,
    &provider,
    NULL));
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }

  RtlZeroMemory(&sublayer, sizeof(sublayer));
  sublayer.subLayerKey = g_MniSublayerKey;
  sublayer.displayData.name = L"Itemba Msaidizi enrolled-process isolation";
  sublayer.providerKey = (GUID*)&g_MniProviderKey;
  sublayer.weight = 0xf000;
  status = MniWfpManagementStatus(FwpmSubLayerAdd0(
    g_Mni.WfpEngine,
    &sublayer,
    NULL));
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }

  status = MniAddManagementCallout(
    g_Mni.WfpEngine,
    &g_MniCalloutV4Key,
    &FWPM_LAYER_ALE_AUTH_CONNECT_V4,
    L"Itemba Msaidizi ALE connect IPv4 callout");
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }
  status = MniAddManagementCallout(
    g_Mni.WfpEngine,
    &g_MniCalloutV6Key,
    &FWPM_LAYER_ALE_AUTH_CONNECT_V6,
    L"Itemba Msaidizi ALE connect IPv6 callout");
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }
  status = MniAddFilter(
    g_Mni.WfpEngine,
    &g_MniCalloutV4Key,
    &FWPM_LAYER_ALE_AUTH_CONNECT_V4,
    L"Itemba Msaidizi fail-closed enrolled IPv4 connect filter");
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }
  status = MniAddFilter(
    g_Mni.WfpEngine,
    &g_MniCalloutV6Key,
    &FWPM_LAYER_ALE_AUTH_CONNECT_V6,
    L"Itemba Msaidizi fail-closed enrolled IPv6 connect filter");
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }

  status = MniWfpManagementStatus(FwpmTransactionCommit0(g_Mni.WfpEngine));
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }
  transactionOpen = FALSE;

  status = PsSetCreateProcessNotifyRoutineEx(MniProcessNotify, FALSE);
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }
  InterlockedExchange(&g_Mni.ProcessNotifyRegistered, 1);
  InterlockedExchange(&g_Mni.WfpRegistered, 1);
  return STATUS_SUCCESS;

Exit:
  if (transactionOpen) {
    FwpmTransactionAbort0(g_Mni.WfpEngine);
  }
  MniWfpStop();
  return status;
}

_IRQL_requires_max_(PASSIVE_LEVEL)
VOID
MniWfpStop(VOID)
{
  PAGED_CODE();
  InterlockedExchange(&g_Mni.WfpRegistered, 0);
  if (InterlockedExchange(&g_Mni.ProcessNotifyRegistered, 0) != 0) {
    PsSetCreateProcessNotifyRoutineEx(MniProcessNotify, TRUE);
  }
  if (g_Mni.WfpEngine != NULL) {
    FwpmEngineClose0(g_Mni.WfpEngine);
    g_Mni.WfpEngine = NULL;
  }
  if (g_Mni.CalloutIdV6 != 0) {
    FwpsCalloutUnregisterById0(g_Mni.CalloutIdV6);
    g_Mni.CalloutIdV6 = 0;
  }
  if (g_Mni.CalloutIdV4 != 0) {
    FwpsCalloutUnregisterById0(g_Mni.CalloutIdV4);
    g_Mni.CalloutIdV4 = 0;
  }
}

#pragma alloc_text(PAGE, MniWfpStart)
#pragma alloc_text(PAGE, MniWfpStop)
