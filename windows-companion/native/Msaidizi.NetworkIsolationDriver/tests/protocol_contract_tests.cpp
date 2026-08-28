#include <cstddef>
#include <cstdint>

#include "../include/msaidizi_network_isolation_protocol.h"

static_assert(MNI_PROTOCOL_VERSION == 3u);
static_assert(MNI_LEGACY_JSON_PROTOCOL_VERSION == 2u);
static_assert(MNI_MAX_FRAME_BYTES == 262144u);
static_assert(MNI_MAX_POLICY_ENTRIES == 512u);
static_assert(MNI_MAX_ENROLLED_PROCESSES == 128u);

static_assert(MNI_IOCTL_LEGACY_ATTEST == 0x00222000u);
static_assert(MNI_IOCTL_LEGACY_BIND == 0x00222004u);
static_assert(MNI_IOCTL_LEGACY_SETTLE == 0x00222008u);
static_assert(MNI_IOCTL_LEGACY_RECOVER == 0x0022200cu);
static_assert(MNI_IOCTL_GET_PROTOCOL == 0x0022e040u);
static_assert(MNI_IOCTL_GET_HEALTH == 0x0022e044u);
static_assert(MNI_IOCTL_REPLACE_POLICY == 0x0022e048u);
static_assert(MNI_IOCTL_ENROLL_PROCESS == 0x0022e04cu);
static_assert(MNI_IOCTL_REMOVE_PROCESS == 0x0022e050u);
static_assert(MNI_IOCTL_SET_KILL_STATE == 0x0022e054u);

static_assert(sizeof(MNI_MESSAGE_HEADER) == 64u);
static_assert(offsetof(MNI_MESSAGE_HEADER, RequestSequence) == 16u);
static_assert(offsetof(MNI_MESSAGE_HEADER, RequestId) == 32u);
static_assert(offsetof(MNI_MESSAGE_HEADER, BootId) == 48u);
static_assert(sizeof(MNI_PROTOCOL_RESPONSE) == 104u);
static_assert(sizeof(MNI_MUTATION_RESPONSE) == 120u);
static_assert(sizeof(MNI_POLICY_ENTRY) == 64u);
static_assert(offsetof(MNI_POLICY_ENTRY, RemoteAddress) == 40u);
static_assert(offsetof(MNI_POLICY_ENTRY, ExpiresAtFileTime100ns) == 56u);
static_assert(MNI_POLICY_REPLACE_BASE_SIZE == 112u);
static_assert(offsetof(MNI_POLICY_REPLACE_REQUEST, Entries) == 112u);
static_assert(sizeof(MNI_PROCESS_ENROLL_REQUEST) == 2248u);
static_assert(offsetof(MNI_PROCESS_ENROLL_REQUEST, NormalizedImageNtPath) == 168u);
static_assert(offsetof(MNI_PROCESS_ENROLL_REQUEST, NormalizedAppId) == 1208u);
static_assert(sizeof(MNI_PROCESS_REMOVE_REQUEST) == 104u);
static_assert(sizeof(MNI_KILL_REQUEST) == 80u);
static_assert(sizeof(MNI_HEALTH_REQUEST) == 96u);
static_assert(sizeof(MNI_HEALTH_COUNTERS) == 96u);
static_assert(sizeof(MNI_HEALTH_RESPONSE) == 360u);

static_assert(MNI_ENDPOINT_BROKER != MNI_ENDPOINT_EGRESS_SUPERVISOR);
static_assert(MNI_ADDRESS_FAMILY_IPV4 == 4u);
static_assert(MNI_ADDRESS_FAMILY_IPV6 == 6u);
static_assert(MNI_IP_PROTOCOL_TCP == 6u);
static_assert(MNI_IP_PROTOCOL_UDP == 17u);
static_assert((MNI_REQUIRED_FEATURES & MNI_FEATURE_ATOMIC_MONOTONIC_POLICY) != 0);
static_assert((MNI_REQUIRED_FEATURES & MNI_FEATURE_REQUEST_REPLAY_PROTECTION) != 0);
static_assert((MNI_REQUIRED_FEATURES & MNI_FEATURE_LATCHED_KILL_STATE) != 0);
static_assert((MNI_REQUIRED_FEATURES & MNI_FEATURE_BOOT_MEASUREMENT_STATUS) != 0);

int main()
{
  return 0;
}
