#pragma once

#include <ntifs.h>
#include <fwpsk.h>
#include <fwpmk.h>
#include <bcrypt.h>
#include <wdmsec.h>

#include "..\include\msaidizi_network_isolation_protocol.h"

#define MNI_POOL_TAG_POLICY 'PnIM'
#define MNI_POOL_TAG_PROCESS 'RnIM'
#define MNI_POOL_TAG_CRYPTO 'CnIM'
#define MNI_POOL_TAG_IO 'InIM'
#define MNI_REPLAY_WINDOW 64u

typedef struct _MNI_POLICY_SNAPSHOT {
  EX_RUNDOWN_REF Rundown;
  UINT64 Generation;
  UINT64 ExpiresAtFileTime100ns;
  UCHAR Sha256[MNI_SHA256_BYTES];
  ULONG EntryCount;
  MNI_POLICY_ENTRY Entries[ANYSIZE_ARRAY];
} MNI_POLICY_SNAPSHOT, *PMNI_POLICY_SNAPSHOT;

typedef struct _MNI_PROCESS_RECORD {
  UINT64 ProcessId;
  UINT64 ProcessCreationTime100ns;
  UINT64 ProcessStartKey;
  UINT64 PolicyGeneration;
  UINT64 ExpiresAtFileTime100ns;
  UCHAR ImageSha256[MNI_SHA256_BYTES];
  UCHAR ProcessIdentitySha256[MNI_SHA256_BYTES];
  USHORT ImagePathChars;
  USHORT AppIdBytes;
  USHORT NormalizedImageNtPath[MNI_MAX_IMAGE_PATH_CHARS];
  UCHAR NormalizedAppId[MNI_MAX_APP_ID_BYTES];
  PEPROCESS Process;
  volatile LONG Terminated;
  volatile LONG StalePid;
} MNI_PROCESS_RECORD, *PMNI_PROCESS_RECORD;

typedef struct _MNI_PROCESS_SNAPSHOT {
  EX_RUNDOWN_REF Rundown;
  ULONG Count;
  MNI_PROCESS_RECORD Records[ANYSIZE_ARRAY];
} MNI_PROCESS_SNAPSHOT, *PMNI_PROCESS_SNAPSHOT;

typedef struct _MNI_COUNTERS {
  volatile LONG64 ConnectsInspected;
  volatile LONG64 ConnectsPermitted;
  volatile LONG64 ConnectsBlockedNoPolicy;
  volatile LONG64 ConnectsBlockedKill;
  volatile LONG64 ConnectsBlockedExpired;
  volatile LONG64 ConnectsBlockedPidReuse;
  volatile LONG64 ConnectsBlockedAppIdentity;
  volatile LONG64 ConnectsBlockedDestination;
  volatile LONG64 PolicyReplacements;
  volatile LONG64 EnrollmentMutations;
  volatile LONG64 ReplayRejections;
  volatile LONG64 InvalidIoctls;
} MNI_COUNTERS, *PMNI_COUNTERS;

typedef struct _MNI_DRIVER_STATE {
  PDEVICE_OBJECT DeviceObject;
  UNICODE_STRING SymbolicLink;
  HANDLE WfpEngine;
  UINT32 CalloutIdV4;
  UINT32 CalloutIdV6;
  volatile LONG WfpRegistered;
  volatile LONG ProcessNotifyRegistered;
  volatile LONG Unloading;
  volatile LONG KillActive;
  volatile LONG OpenHandle;
  volatile LONG64 KillGeneration;
  UINT64 BootTimeFileTime100ns;
  UCHAR BootId[MNI_UUID_BYTES];
  UCHAR BootMeasurementSha256[MNI_SHA256_BYTES];
  UCHAR DriverImageSha256[MNI_SHA256_BYTES];
  KSPIN_LOCK PolicyPointerLock;
  KSPIN_LOCK ProcessPointerLock;
  PMNI_POLICY_SNAPSHOT Policy;
  PMNI_PROCESS_SNAPSHOT Processes;
  FAST_MUTEX MutationMutex;
  volatile LONG64 LastRequestSequence;
  ULONG ReplayCursor;
  UCHAR ReplayIds[MNI_REPLAY_WINDOW][MNI_UUID_BYTES];
  MNI_COUNTERS Counters;
} MNI_DRIVER_STATE, *PMNI_DRIVER_STATE;

extern MNI_DRIVER_STATE g_Mni;

DRIVER_INITIALIZE DriverEntry;
DRIVER_UNLOAD MniDriverUnload;

_Dispatch_type_(IRP_MJ_CREATE)
DRIVER_DISPATCH MniDispatchCreate;
_Dispatch_type_(IRP_MJ_CLEANUP)
DRIVER_DISPATCH MniDispatchCleanup;
_Dispatch_type_(IRP_MJ_CLOSE)
DRIVER_DISPATCH MniDispatchClose;
_Dispatch_type_(IRP_MJ_DEVICE_CONTROL)
DRIVER_DISPATCH MniDispatchDeviceControl;

NTSTATUS MniWfpStart(_In_ PDEVICE_OBJECT deviceObject);
VOID MniWfpStop(VOID);

NTSTATUS MniReplacePolicy(
  _In_reads_bytes_(inputLength) const MNI_POLICY_REPLACE_REQUEST* request,
  _In_ ULONG inputLength,
  _Out_ MNI_MUTATION_RESPONSE* response);
NTSTATUS MniEnrollProcess(
  _In_ const MNI_PROCESS_ENROLL_REQUEST* request,
  _Out_ MNI_MUTATION_RESPONSE* response);
NTSTATUS MniRemoveProcess(
  _In_ const MNI_PROCESS_REMOVE_REQUEST* request,
  _Out_ MNI_MUTATION_RESPONSE* response);
NTSTATUS MniSetKillState(
  _In_ const MNI_KILL_REQUEST* request,
  _Out_ MNI_MUTATION_RESPONSE* response);
NTSTATUS MniGetHealth(
  _In_ const MNI_HEALTH_REQUEST* request,
  _Out_ MNI_HEALTH_RESPONSE* response);

PMNI_POLICY_SNAPSHOT MniAcquirePolicy(VOID);
VOID MniReleasePolicy(_In_opt_ PMNI_POLICY_SNAPSHOT policy);
PMNI_PROCESS_SNAPSHOT MniAcquireProcesses(VOID);
VOID MniReleaseProcesses(_In_opt_ PMNI_PROCESS_SNAPSHOT processes);
VOID MniDestroyAllPolicy(VOID);
VOID MniProcessNotify(
  _Inout_ PEPROCESS process,
  _In_ HANDLE processId,
  _Inout_opt_ PPS_CREATE_NOTIFY_INFO createInfo);

BOOLEAN MniClassifyConnect(
  _In_ UINT64 processId,
  _In_reads_bytes_opt_(appIdBytes) const UCHAR* appId,
  _In_ USHORT appIdBytes,
  _In_ UCHAR addressFamily,
  _In_ UCHAR protocol,
  _In_ USHORT remotePort,
  _In_reads_(16) const UCHAR remoteAddress[16]);

NTSTATUS MniHashBuffers(
  _In_reads_(bufferCount) const UCHAR* const* buffers,
  _In_reads_(bufferCount) const ULONG* lengths,
  _In_ ULONG bufferCount,
  _Out_writes_(MNI_SHA256_BYTES) UCHAR digest[MNI_SHA256_BYTES]);

VOID MniFillResponseHeader(
  _Out_ MNI_MESSAGE_HEADER* header,
  _In_ USHORT messageType,
  _In_ ULONG size,
  _In_opt_ const MNI_MESSAGE_HEADER* request);
