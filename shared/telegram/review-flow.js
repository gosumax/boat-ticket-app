import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_REVIEW_FLOW_RESULT_VERSION = 'telegram_review_flow_result.v1';
export const TELEGRAM_REVIEW_REQUEST_STATE_VERSION =
  'telegram_review_request_state.v1';
export const TELEGRAM_REVIEW_SUBMISSION_VERSION = 'telegram_review_submission.v1';

export const TELEGRAM_REVIEW_STATUSES = Object.freeze([
  'review_not_available',
  'review_available',
  'review_submitted',
]);

export const TELEGRAM_REVIEW_RATING_MIN = 1;
export const TELEGRAM_REVIEW_RATING_MAX = 5;
export const TELEGRAM_REVIEW_COMMENT_MAX_LENGTH = 280;

export function freezeTelegramReviewFlowValue(value) {
  return freezeTelegramHandoffValue(value);
}
