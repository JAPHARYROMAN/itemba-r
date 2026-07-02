import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Payload posted by an external messaging provider (SMS / mobile-money / email
 * gateway) to report the delivery outcome of a previously-sent message.
 *
 * `messageId` is resolved against the ExternalMessage row within the API key's
 * bound company (matched by `id`, `messageNumber`, or `externalReference`).
 *
 * `status` is the provider's raw status string; it is mapped to an
 * `ExternalMessageStatus` by {@link mapProviderStatus}. Anything the provider
 * sends that is not a recognised terminal/transit status is treated as a
 * no-op (the message status is left unchanged) rather than corrupting state.
 */
export class MessageDeliveryCallbackDto {
  @IsNotEmpty()
  @IsString()
  messageId!: string;

  @IsNotEmpty()
  @IsString()
  status!: string;

  /**
   * Provider-side reference for the message (e.g. carrier message id). Persisted
   * to `externalReference` when present so the two systems stay correlated.
   */
  @IsOptional()
  @IsString()
  providerReference?: string;

  /** Human-readable failure reason from the provider (persisted on FAILED). */
  @IsOptional()
  @IsString()
  failureReason?: string;

  /** ISO-8601 timestamp of the delivery event from the provider, if supplied. */
  @IsOptional()
  @IsString()
  timestamp?: string;
}
