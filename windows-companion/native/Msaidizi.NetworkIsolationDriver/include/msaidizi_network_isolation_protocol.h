#pragma once

/*
 * Itemba Msaidizi network-isolation driver protocol.
 *
 * This header is shared by kernel and user mode. Every binary message is
 * little-endian, fixed-width, 8-byte packed, size-delimited, and versioned.
 * Variable policy entries are the only trailing data. Unknown versions,
 * message types, flags, reserved bits, sizes, or enum values are rejected.
 */

#include <stdint.h>

#define MNI_PROTOCOL_VERSION                         3u
#define MNI_LEGACY_JSON_PROTOCOL_VERSION             2u
#define MNI_MAX_FRAME_BYTES                          262144u
#define MNI_MAX_POLICY_ENTRIES                       512u
#define MNI_MAX_ENROLLED_PROCESSES                   128u
#define MNI_MAX_IMAGE_PATH_CHARS                     520u
#define MNI_MAX_APP_ID_BYTES                         1040u
#define MNI_SHA256_BYTES                             32u
#define MNI_UUID_BYTES                               16u

#define MNI_FILE_DEVICE_UNKNOWN                      0x00000022u
#define MNI_METHOD_BUFFERED                          0u
#define MNI_FILE_ANY_ACCESS                          0u
#define MNI_FILE_READ_WRITE_ACCESS                   3u
#define MNI_CTL_CODE(device, function, method, access) \
  (((device) << 16) | ((access) << 14) | ((function) << 2) | (method))

/* Existing WindowsKernelIsolationDriverClient v2 JSON exchanges. */
#define MNI_IOCTL_LEGACY_ATTEST                      0x00222000u
#define MNI_IOCTL_LEGACY_BIND                        0x00222004u
#define MNI_IOCTL_LEGACY_SETTLE                      0x00222008u
#define MNI_IOCTL_LEGACY_RECOVER                     0x0022200cu

/* Closed v3 binary enforcement surface. */
#define MNI_IOCTL_GET_PROTOCOL MNI_CTL_CODE( \
  MNI_FILE_DEVICE_UNKNOWN, 0x810u, MNI_METHOD_BUFFERED, MNI_FILE_READ_WRITE_ACCESS)
#define MNI_IOCTL_GET_HEALTH MNI_CTL_CODE( \
  MNI_FILE_DEVICE_UNKNOWN, 0x811u, MNI_METHOD_BUFFERED, MNI_FILE_READ_WRITE_ACCESS)
#define MNI_IOCTL_REPLACE_POLICY MNI_CTL_CODE( \
  MNI_FILE_DEVICE_UNKNOWN, 0x812u, MNI_METHOD_BUFFERED, MNI_FILE_READ_WRITE_ACCESS)
#define MNI_IOCTL_ENROLL_PROCESS MNI_CTL_CODE( \
  MNI_FILE_DEVICE_UNKNOWN, 0x813u, MNI_METHOD_BUFFERED, MNI_FILE_READ_WRITE_ACCESS)
#define MNI_IOCTL_REMOVE_PROCESS MNI_CTL_CODE( \
  MNI_FILE_DEVICE_UNKNOWN, 0x814u, MNI_METHOD_BUFFERED, MNI_FILE_READ_WRITE_ACCESS)
#define MNI_IOCTL_SET_KILL_STATE MNI_CTL_CODE( \
  MNI_FILE_DEVICE_UNKNOWN, 0x815u, MNI_METHOD_BUFFERED, MNI_FILE_READ_WRITE_ACCESS)

#define MNI_MESSAGE_PROTOCOL_REQUEST                 1u
#define MNI_MESSAGE_PROTOCOL_RESPONSE                2u
#define MNI_MESSAGE_HEALTH_REQUEST                   3u
#define MNI_MESSAGE_HEALTH_RESPONSE                  4u
#define MNI_MESSAGE_POLICY_REPLACE_REQUEST           5u
#define MNI_MESSAGE_PROCESS_ENROLL_REQUEST           6u
#define MNI_MESSAGE_PROCESS_REMOVE_REQUEST           7u
#define MNI_MESSAGE_KILL_REQUEST                     8u
#define MNI_MESSAGE_MUTATION_RESPONSE                9u

#define MNI_ENDPOINT_BROKER                          1u
#define MNI_ENDPOINT_EGRESS_SUPERVISOR               2u
#define MNI_ADDRESS_FAMILY_IPV4                      4u
#define MNI_ADDRESS_FAMILY_IPV6                      6u
#define MNI_IP_PROTOCOL_TCP                          6u
#define MNI_IP_PROTOCOL_UDP                          17u

#define MNI_STATUS_OK                                0u
#define MNI_STATUS_INVALID_FRAME                     1u
#define MNI_STATUS_VERSION_MISMATCH                  2u
#define MNI_STATUS_ACCESS_DENIED                     3u
#define MNI_STATUS_BOOT_MISMATCH                     4u
#define MNI_STATUS_REPLAY                            5u
#define MNI_STATUS_STALE_GENERATION                  6u
#define MNI_STATUS_KILL_ACTIVE                       7u
#define MNI_STATUS_POLICY_INVALID                    8u
#define MNI_STATUS_PROCESS_IDENTITY_MISMATCH         9u
#define MNI_STATUS_PROCESS_NOT_FOUND                 10u
#define MNI_STATUS_CAPACITY                          11u
#define MNI_STATUS_INTERNAL_ERROR                    12u
#define MNI_STATUS_LEGACY_NOT_PROVISIONED            13u

#define MNI_FEATURE_ALE_CONNECT_V4                   (1ull << 0)
#define MNI_FEATURE_ALE_CONNECT_V6                   (1ull << 1)
#define MNI_FEATURE_PID_CREATION_BINDING             (1ull << 2)
#define MNI_FEATURE_IMAGE_PATH_APP_ID_BINDING        (1ull << 3)
#define MNI_FEATURE_IMAGE_SHA256_BINDING             (1ull << 4)
#define MNI_FEATURE_ATOMIC_MONOTONIC_POLICY          (1ull << 5)
#define MNI_FEATURE_REQUEST_REPLAY_PROTECTION        (1ull << 6)
#define MNI_FEATURE_POLICY_EXPIRY                    (1ull << 7)
#define MNI_FEATURE_LATCHED_KILL_STATE               (1ull << 8)
#define MNI_FEATURE_DYNAMIC_WFP_SESSION              (1ull << 9)
#define MNI_FEATURE_PROCESS_NOTIFY_PID_REUSE         (1ull << 10)
#define MNI_FEATURE_HEALTH_COUNTERS                  (1ull << 11)
#define MNI_FEATURE_BOOT_MEASUREMENT_STATUS          (1ull << 12)

#define MNI_REQUIRED_FEATURES ( \
  MNI_FEATURE_ALE_CONNECT_V4 | MNI_FEATURE_ALE_CONNECT_V6 | \
  MNI_FEATURE_PID_CREATION_BINDING | MNI_FEATURE_IMAGE_PATH_APP_ID_BINDING | \
  MNI_FEATURE_IMAGE_SHA256_BINDING | MNI_FEATURE_ATOMIC_MONOTONIC_POLICY | \
  MNI_FEATURE_REQUEST_REPLAY_PROTECTION | MNI_FEATURE_POLICY_EXPIRY | \
  MNI_FEATURE_LATCHED_KILL_STATE | MNI_FEATURE_DYNAMIC_WFP_SESSION | \
  MNI_FEATURE_PROCESS_NOTIFY_PID_REUSE | MNI_FEATURE_HEALTH_COUNTERS | \
  MNI_FEATURE_BOOT_MEASUREMENT_STATUS)

#define MNI_HEALTH_WFP_REGISTERED                    (1u << 0)
#define MNI_HEALTH_POLICY_ACTIVE                     (1u << 1)
#define MNI_HEALTH_KILL_ACTIVE                       (1u << 2)
#define MNI_HEALTH_UNLOADING                         (1u << 3)
#define MNI_HEALTH_DRIVER_MEASUREMENT_PROVISIONED    (1u << 4)
#define MNI_HEALTH_BOOT_MEASUREMENT_PROVISIONED      (1u << 5)

#pragma pack(push, 8)

typedef struct MNI_MESSAGE_HEADER {
  uint32_t Size;
  uint16_t Version;
  uint16_t MessageType;
  uint32_t Flags;
  uint32_t Reserved;
  uint64_t RequestSequence;
  uint64_t PolicyGeneration;
  uint8_t RequestId[MNI_UUID_BYTES];
  uint8_t BootId[MNI_UUID_BYTES];
} MNI_MESSAGE_HEADER;

typedef struct MNI_PROTOCOL_RESPONSE {
  MNI_MESSAGE_HEADER Header;
  uint16_t MinimumVersion;
  uint16_t MaximumVersion;
  uint32_t MaximumFrameBytes;
  uint64_t Features;
  uint32_t MessageHeaderSize;
  uint32_t PolicyEntrySize;
  uint32_t PolicyRequestBaseSize;
  uint32_t EnrollmentRequestSize;
  uint32_t HealthResponseSize;
  uint32_t Reserved;
} MNI_PROTOCOL_RESPONSE;

typedef struct MNI_MUTATION_RESPONSE {
  MNI_MESSAGE_HEADER Header;
  uint32_t Status;
  uint32_t ErrorDetail;
  uint64_t CurrentPolicyGeneration;
  uint64_t AppliedRequestSequence;
  uint8_t CurrentPolicySha256[MNI_SHA256_BYTES];
} MNI_MUTATION_RESPONSE;

typedef struct MNI_POLICY_ENTRY {
  uint8_t ProcessIdentitySha256[MNI_SHA256_BYTES];
  uint8_t EndpointKind;
  uint8_t AddressFamily;
  uint8_t IpProtocol;
  uint8_t PrefixLength;
  uint16_t RemotePort;
  uint16_t Reserved;
  uint8_t RemoteAddress[16];
  uint64_t ExpiresAtFileTime100ns;
} MNI_POLICY_ENTRY;

typedef struct MNI_POLICY_REPLACE_REQUEST {
  MNI_MESSAGE_HEADER Header;
  uint8_t PolicySha256[MNI_SHA256_BYTES];
  uint64_t ExpiresAtFileTime100ns;
  uint32_t EntryCount;
  uint32_t Reserved;
  MNI_POLICY_ENTRY Entries[1];
} MNI_POLICY_REPLACE_REQUEST;

typedef struct MNI_PROCESS_ENROLL_REQUEST {
  MNI_MESSAGE_HEADER Header;
  uint64_t ProcessId;
  uint64_t ProcessCreationTime100ns;
  uint64_t ProcessStartKey;
  uint64_t ExpiresAtFileTime100ns;
  uint8_t ImageSha256[MNI_SHA256_BYTES];
  uint8_t ProcessIdentitySha256[MNI_SHA256_BYTES];
  uint16_t ImagePathChars;
  uint16_t AppIdBytes;
  uint32_t Reserved;
  uint16_t NormalizedImageNtPath[MNI_MAX_IMAGE_PATH_CHARS];
  uint8_t NormalizedAppId[MNI_MAX_APP_ID_BYTES];
} MNI_PROCESS_ENROLL_REQUEST;

typedef struct MNI_PROCESS_REMOVE_REQUEST {
  MNI_MESSAGE_HEADER Header;
  uint64_t ProcessId;
  uint8_t ProcessIdentitySha256[MNI_SHA256_BYTES];
} MNI_PROCESS_REMOVE_REQUEST;

typedef struct MNI_KILL_REQUEST {
  MNI_MESSAGE_HEADER Header;
  uint64_t KillGeneration;
  uint32_t ReasonCode;
  uint32_t Reserved;
} MNI_KILL_REQUEST;

typedef struct MNI_HEALTH_REQUEST {
  MNI_MESSAGE_HEADER Header;
  uint8_t ChallengeNonce[MNI_SHA256_BYTES];
} MNI_HEALTH_REQUEST;

typedef struct MNI_HEALTH_COUNTERS {
  uint64_t ConnectsInspected;
  uint64_t ConnectsPermitted;
  uint64_t ConnectsBlockedNoPolicy;
  uint64_t ConnectsBlockedKill;
  uint64_t ConnectsBlockedExpired;
  uint64_t ConnectsBlockedPidReuse;
  uint64_t ConnectsBlockedAppIdentity;
  uint64_t ConnectsBlockedDestination;
  uint64_t PolicyReplacements;
  uint64_t EnrollmentMutations;
  uint64_t ReplayRejections;
  uint64_t InvalidIoctls;
} MNI_HEALTH_COUNTERS;

typedef struct MNI_HEALTH_RESPONSE {
  MNI_MESSAGE_HEADER Header;
  uint32_t Status;
  uint32_t HealthFlags;
  uint64_t BootTimeFileTime100ns;
  uint64_t CurrentPolicyGeneration;
  uint64_t KillGeneration;
  uint64_t PolicyExpiresAtFileTime100ns;
  uint64_t LastAcceptedRequestSequence;
  uint8_t CurrentPolicySha256[MNI_SHA256_BYTES];
  uint8_t BootMeasurementSha256[MNI_SHA256_BYTES];
  uint8_t DriverImageSha256[MNI_SHA256_BYTES];
  uint32_t EnrolledProcessCount;
  uint32_t PolicyEntryCount;
  uint32_t CalloutIdV4;
  uint32_t CalloutIdV6;
  uint32_t Reserved;
  MNI_HEALTH_COUNTERS Counters;
  uint8_t ChallengeResponseSha256[MNI_SHA256_BYTES];
} MNI_HEALTH_RESPONSE;

#pragma pack(pop)

#define MNI_POLICY_REPLACE_BASE_SIZE \
  ((uint32_t)(sizeof(MNI_POLICY_REPLACE_REQUEST) - sizeof(MNI_POLICY_ENTRY)))
