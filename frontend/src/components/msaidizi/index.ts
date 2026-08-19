/**
 * The parts of the Msaidizi page that are not the thread.
 *
 * The conversation list, the standing statements about what the assistant is
 * allowed to do here, and the two affordances that make a finished run
 * reviewable: which clock the conversation is on, and the session id that leads
 * to the audit trail.
 *
 * The thread and composer are separate, and the page composes all of it. Nothing
 * exported here fetches on render except the two hooks, which say so in their
 * names.
 */

export {
  MsaidiziModeBanner,
  MSAIDIZI_AUDIT_NOTE,
  describeMsaidiziMode,
  describeMsaidiziNarrowing,
  effectiveWriteMode,
  msaidiziAvailability,
} from './mode-banner';
export type {
  MsaidiziAvailability,
  MsaidiziModeBannerProps,
  MsaidiziModeDescription,
  MsaidiziModeTone,
  MsaidiziNarrowingDescription,
} from './mode-banner';

export {
  MsaidiziConversationList,
  conversationTitle,
  describeConversationActivity,
  describeConversationWhen,
} from './conversation-list';
export type { MsaidiziConversationListProps } from './conversation-list';

export { MsaidiziResumabilityNotice, describeResumability, resumeChipLabel } from './resumability';
export type {
  MsaidiziResumabilityNoticeProps,
  MsaidiziResumeDescription,
  MsaidiziResumeState,
} from './resumability';

export { MsaidiziSessionHandle } from './session-handle';
export type { MsaidiziSessionHandleProps } from './session-handle';

export { useMsaidiziCapabilities, useMsaidiziConversations } from './hooks';
export type {
  UseMsaidiziCapabilitiesResult,
  UseMsaidiziConversationsOptions,
  UseMsaidiziConversationsResult,
} from './hooks';
