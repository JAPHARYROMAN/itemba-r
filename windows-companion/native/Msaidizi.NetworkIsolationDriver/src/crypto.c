#include "driver.h"

_IRQL_requires_max_(PASSIVE_LEVEL)
NTSTATUS
MniHashBuffers(
  _In_reads_(bufferCount) const UCHAR* const* buffers,
  _In_reads_(bufferCount) const ULONG* lengths,
  _In_ ULONG bufferCount,
  _Out_writes_(MNI_SHA256_BYTES) UCHAR digest[MNI_SHA256_BYTES])
{
  BCRYPT_ALG_HANDLE algorithm = NULL;
  BCRYPT_HASH_HANDLE hash = NULL;
  PUCHAR hashObject = NULL;
  ULONG objectLength = 0;
  ULONG hashLength = 0;
  ULONG returned = 0;
  ULONG index;
  NTSTATUS status;

  PAGED_CODE();

  if (buffers == NULL || lengths == NULL || digest == NULL || bufferCount == 0) {
    return STATUS_INVALID_PARAMETER;
  }

  RtlZeroMemory(digest, MNI_SHA256_BYTES);
  status = BCryptOpenAlgorithmProvider(
    &algorithm,
    BCRYPT_SHA256_ALGORITHM,
    NULL,
    0);
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }

  status = BCryptGetProperty(
    algorithm,
    BCRYPT_OBJECT_LENGTH,
    (PUCHAR)&objectLength,
    sizeof(objectLength),
    &returned,
    0);
  if (!NT_SUCCESS(status) || returned != sizeof(objectLength) || objectLength == 0) {
    status = STATUS_INVALID_BUFFER_SIZE;
    goto Exit;
  }

  status = BCryptGetProperty(
    algorithm,
    BCRYPT_HASH_LENGTH,
    (PUCHAR)&hashLength,
    sizeof(hashLength),
    &returned,
    0);
  if (!NT_SUCCESS(status) || hashLength != MNI_SHA256_BYTES) {
    status = STATUS_INVALID_BUFFER_SIZE;
    goto Exit;
  }

  hashObject = (PUCHAR)ExAllocatePool2(
    POOL_FLAG_PAGED,
    objectLength,
    MNI_POOL_TAG_CRYPTO);
  if (hashObject == NULL) {
    status = STATUS_INSUFFICIENT_RESOURCES;
    goto Exit;
  }
  RtlZeroMemory(hashObject, objectLength);

  status = BCryptCreateHash(
    algorithm,
    &hash,
    hashObject,
    objectLength,
    NULL,
    0,
    0);
  if (!NT_SUCCESS(status)) {
    goto Exit;
  }

  for (index = 0; index < bufferCount; ++index) {
    if (lengths[index] == 0) {
      continue;
    }
    if (buffers[index] == NULL) {
      status = STATUS_INVALID_PARAMETER;
      goto Exit;
    }
    status = BCryptHashData(hash, (PUCHAR)buffers[index], lengths[index], 0);
    if (!NT_SUCCESS(status)) {
      goto Exit;
    }
  }

  status = BCryptFinishHash(hash, digest, MNI_SHA256_BYTES, 0);

Exit:
  if (hash != NULL) {
    BCryptDestroyHash(hash);
  }
  if (hashObject != NULL) {
    RtlSecureZeroMemory(hashObject, objectLength);
    ExFreePoolWithTag(hashObject, MNI_POOL_TAG_CRYPTO);
  }
  if (algorithm != NULL) {
    BCryptCloseAlgorithmProvider(algorithm, 0);
  }
  if (!NT_SUCCESS(status)) {
    RtlSecureZeroMemory(digest, MNI_SHA256_BYTES);
  }
  return status;
}

#pragma alloc_text(PAGE, MniHashBuffers)

