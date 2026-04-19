# Telegram Domain Foundation

This document is the source of truth for the first-version Telegram domain model in `boat-ticket-app`.

It defines the Telegram-side entities, boundaries, statuses, and event model that future implementation must follow without changing existing seller, dispatcher, owner, admin, API, or DB behavior in this task.

## Scope

- This is a documentation-only design.
- No runtime behavior is introduced here.
- No DB schema, migrations, backend routes, bot handlers, or Mini App UI are introduced here.
- Existing selling, presale, ticket, owner, dispatcher, and admin runtime remains unchanged.

## First-Version Implementation Intent

The first Telegram version is a guest acquisition, request capture, seller attribution, prepayment coordination, ticket delivery, and post-trip follow-up layer around the existing selling domain.

The first-version implementation order must remain:

1. source entry and attribution foundation
2. guest identity and entry capture
3. booking request intake
4. booking hold tracking
5. seller follow-up and no-reach outcomes
6. prepayment confirmation handoff into confirmed presale
7. Telegram ticket delivery and reminder notifications
8. post-trip follow-up and lightweight analytics

## Domain Boundary

### What Belongs To Telegram Domain

- guest acquisition from Telegram entry points
- Telegram-specific guest identity and communication context
- source attribution and QR entry attribution
- Telegram-origin booking intent before confirmed presale creation
- temporary hold coordination state for guest communication
- Telegram notifications and content composition metadata
- Telegram analytics and post-trip engagement artifacts
- Telegram-facing ticket delivery view models

### What Stays In Existing Selling/Presale/Ticket Domain

- canonical presale creation
- presale financial fields
- ticket creation and ticket ownership records
- seat allocation
- prepayment accounting
- refund and delete behavior
- ledger writes and financial invariants

### What Stays In Existing Owner/Dispatcher/Admin Runtime

- seller runtime behavior
- dispatcher runtime behavior
- owner reporting and invariants
- admin management flows
- shift-close logic
- production auth and role rules

### Mapping Rule: Telegram Request To Confirmed Presale

- `BookingRequest` is a Telegram-side demand record, not a confirmed sale.
- `BookingHold` is a temporary coordination record, not a canonical booking.
- A Telegram-origin request maps into the existing selling domain only after prepayment confirmation.
- Only after prepayment confirmation may the system create or attach to a canonical existing-domain presale.
- The resulting confirmed presale and tickets remain owned by the current selling/presale/ticket domain, not by Telegram domain entities.

## Entity Model

Each entity below defines purpose, required fields, main relations, lifecycle role, and implementation scope.

### 1. GuestProfile

**Purpose**

Represents the Telegram guest identity known to the system before and after booking interactions.

**Required fields**

- `guest_profile_id`
- `telegram_user_id`
- `display_name`
- `username`
- `language_code`
- `phone_e164`
- `consent_status`
- `first_seen_at`
- `last_seen_at`
- `profile_status`

**Main relations**

- one `GuestProfile` to many `GuestEntry`
- one `GuestProfile` to many `BookingRequest`
- one `GuestProfile` to many `TelegramNotification`
- one `GuestProfile` to many `AnalyticsEvent`
- one `GuestProfile` to many `PostTripMessage`

**Lifecycle role**

Acts as the stable Telegram guest anchor across acquisition, booking request, ticket delivery, and post-trip communication.

**Implementation scope**

- first-version required

### 2. TrafficSource

**Purpose**

Defines the marketing or operational source that brought a guest into Telegram flow.

**Required fields**

- `traffic_source_id`
- `source_code`
- `source_type`
- `source_name`
- `default_seller_id`
- `is_active`
- `created_at`

**Main relations**

- one `TrafficSource` to many `SourceQRCode`
- one `TrafficSource` to many `GuestEntry`
- one `TrafficSource` to many `SellerAttributionSession`
- one `TrafficSource` to many `AnalyticsEvent`

**Lifecycle role**

Provides the top-level acquisition source classification for attribution, analytics, and later seller follow-up.

**Implementation scope**

- first-version required

### 3. SourceQRCode

**Purpose**

Represents a concrete QR entry point bound to a traffic source and optionally to a seller attribution rule.

**Required fields**

- `source_qr_code_id`
- `qr_token`
- `traffic_source_id`
- `seller_id`
- `entry_context`
- `is_active`
- `created_at`

**Main relations**

- many `SourceQRCode` to one `TrafficSource`
- one `SourceQRCode` to many `GuestEntry`
- one `SourceQRCode` to many `SellerAttributionSession`

**Lifecycle role**

Captures the exact entry artifact used by the guest so the system can preserve acquisition and seller attribution provenance.

**Implementation scope**

- first-version required

### 4. SellerAttributionSession

**Purpose**

Represents the temporary seller-binding window created from a Telegram source entry.

**Required fields**

- `seller_attribution_session_id`
- `guest_profile_id`
- `traffic_source_id`
- `source_qr_code_id`
- `seller_id`
- `starts_at`
- `expires_at`
- `attribution_status`
- `binding_reason`

**Main relations**

- many `SellerAttributionSession` to one `GuestProfile`
- many `SellerAttributionSession` to one `TrafficSource`
- many `SellerAttributionSession` to one `SourceQRCode`
- one `SellerAttributionSession` to many `BookingRequest`
- one `SellerAttributionSession` to many `BookingRequestEvent`

**Lifecycle role**

Defines who has the first right to reach and convert the guest during the attribution window.

**Implementation scope**

- first-version required

### 5. GuestEntry

**Purpose**

Captures each Telegram entry into the system from QR, deep link, or other approved Telegram entry point.

**Required fields**

- `guest_entry_id`
- `guest_profile_id`
- `entry_at`
- `entry_channel`
- `traffic_source_id`
- `source_qr_code_id`
- `entry_payload`
- `entry_status`

**Main relations**

- many `GuestEntry` to one `GuestProfile`
- many `GuestEntry` to one `TrafficSource`
- many `GuestEntry` to one `SourceQRCode`
- one `GuestEntry` to zero or many `AnalyticsEvent`

**Lifecycle role**

Preserves the initial entry fact and raw attribution context before booking starts.

**Implementation scope**

- first-version required

### 6. BookingRequest

**Purpose**

Represents a guest's Telegram-origin booking intent before it becomes a confirmed presale.

**Required fields**

- `booking_request_id`
- `guest_profile_id`
- `seller_attribution_session_id`
- `requested_trip_date`
- `requested_time_slot`
- `requested_seats`
- `requested_ticket_mix`
- `contact_phone_e164`
- `request_status`
- `created_at`
- `last_status_at`

**Main relations**

- many `BookingRequest` to one `GuestProfile`
- many `BookingRequest` to one `SellerAttributionSession`
- one `BookingRequest` to zero or one `BookingHold`
- one `BookingRequest` to many `BookingRequestEvent`
- one `BookingRequest` to many `TelegramNotification`
- one `BookingRequest` to zero or one canonical presale reference after prepayment confirmation

**Lifecycle role**

Acts as the central Telegram-side booking aggregate until the request either expires, is cancelled, is not reached, or becomes a confirmed presale handoff.

**Implementation scope**

- first-version required

### 7. BookingHold

**Purpose**

Represents temporary seller-communicated capacity reservation state while prepayment is pending.

**Required fields**

- `booking_hold_id`
- `booking_request_id`
- `hold_scope`
- `hold_expires_at`
- `hold_status`
- `requested_amount`
- `currency`
- `started_at`
- `last_extended_at`

**Main relations**

- one `BookingHold` to one `BookingRequest`
- one `BookingHold` to many `BookingRequestEvent`
- one `BookingHold` to many `TelegramNotification`

**Lifecycle role**

Tracks whether the guest still has a live temporary reservation window before canonical presale confirmation.

**Implementation scope**

- first-version required

### 8. BookingRequestEvent

**Purpose**

Provides the immutable Telegram-side event trail for request, attribution, hold, and conversion milestones.

**Required fields**

- `booking_request_event_id`
- `booking_request_id`
- `event_type`
- `event_at`
- `actor_type`
- `actor_id`
- `event_payload`

**Main relations**

- many `BookingRequestEvent` to one `BookingRequest`
- many `BookingRequestEvent` to zero or one `BookingHold`
- many `BookingRequestEvent` to zero or one `SellerAttributionSession`

**Lifecycle role**

Forms the audit trail and orchestration backbone for Telegram request lifecycle state changes.

**Implementation scope**

- first-version required

### 9. TelegramNotification

**Purpose**

Represents an outbound Telegram communication attempt or delivery record.

**Required fields**

- `telegram_notification_id`
- `guest_profile_id`
- `booking_request_id`
- `notification_type`
- `content_block_id`
- `send_status`
- `scheduled_for`
- `sent_at`
- `delivery_provider`

**Main relations**

- many `TelegramNotification` to one `GuestProfile`
- many `TelegramNotification` to zero or one `BookingRequest`
- many `TelegramNotification` to one `TelegramContentBlock`
- one `TelegramNotification` to zero or many `AnalyticsEvent`

**Lifecycle role**

Tracks all guest-facing delivery operations such as ticket send, reminders, boarding notice, post-trip messages, and reach attempts.

**Implementation scope**

- first-version required

### 10. TelegramContentBlock

**Purpose**

Represents a reusable Telegram message content definition independent from delivery attempt state.

**Required fields**

- `telegram_content_block_id`
- `content_key`
- `content_type`
- `channel_type`
- `version`
- `locale`
- `body_template`
- `is_active`

**Main relations**

- one `TelegramContentBlock` to many `TelegramNotification`
- one `TelegramContentBlock` to many `PostTripMessage`

**Lifecycle role**

Separates reusable communication content from per-guest notification execution.

**Implementation scope**

- first-version required

### 11. AnalyticsEvent

**Purpose**

Captures first-version Telegram analytics facts for entry, attribution, communication, and review flow.

**Required fields**

- `analytics_event_id`
- `event_type`
- `event_at`
- `guest_profile_id`
- `traffic_source_id`
- `booking_request_id`
- `notification_id`
- `event_value`
- `event_payload`

**Main relations**

- many `AnalyticsEvent` to zero or one `GuestProfile`
- many `AnalyticsEvent` to zero or one `TrafficSource`
- many `AnalyticsEvent` to zero or one `BookingRequest`
- many `AnalyticsEvent` to zero or one `TelegramNotification`

**Lifecycle role**

Provides a lightweight analytics stream for funnel visibility without becoming the financial source of truth.

**Implementation scope**

- first-version required

### 12. PostTripMessage

**Purpose**

Represents the post-trip guest contact artifact that is actually sent or scheduled after the trip.

**Required fields**

- `post_trip_message_id`
- `guest_profile_id`
- `booking_request_id`
- `content_block_id`
- `message_type`
- `scheduled_for`
- `sent_at`
- `message_status`

**Main relations**

- many `PostTripMessage` to one `GuestProfile`
- many `PostTripMessage` to zero or one `BookingRequest`
- many `PostTripMessage` to one `TelegramContentBlock`
- one `PostTripMessage` to zero or one `PostTripOffer`

**Lifecycle role**

Carries the post-trip communication action, such as thank-you, review request, or follow-up offer.

**Implementation scope**

- first-version required

### 13. PostTripOffer

**Purpose**

Represents the offer payload attached to a post-trip message when a follow-up incentive is used.

**Required fields**

- `post_trip_offer_id`
- `post_trip_message_id`
- `offer_type`
- `offer_code`
- `offer_status`
- `valid_from`
- `valid_until`

**Main relations**

- one `PostTripOffer` to one `PostTripMessage`
- one `PostTripOffer` to zero or many `AnalyticsEvent`

**Lifecycle role**

Provides a structured post-trip incentive model without expanding into partner commerce or referral implementation yet.

**Implementation scope**

- first-version required

### 14. TelegramTicketView

**Purpose**

Represents the Telegram-facing delivery view model for a confirmed ticket or booking summary after prepayment confirmation.

**Required fields**

- `telegram_ticket_view_id`
- `guest_profile_id`
- `booking_request_id`
- `presale_id`
- `ticket_status`
- `trip_summary`
- `passenger_summary`
- `boarding_instructions`
- `delivery_version`
- `generated_at`

**Main relations**

- many `TelegramTicketView` to one `GuestProfile`
- many `TelegramTicketView` to one `BookingRequest`
- many `TelegramTicketView` to one canonical presale reference
- one `TelegramTicketView` to many `TelegramNotification`

**Lifecycle role**

Acts as the Telegram delivery projection of confirmed existing-domain ticket information without replacing canonical presale or ticket records.

**Implementation scope**

- first-version required

## Future-Foundation Only Entities

These domains may be prepared conceptually later but must not be implemented in first version.

### Online Payment Foundation

- future only
- may later define payment intent, payment session, payment provider callback, and reconciliation support
- must not change current prepayment confirmation rules in first version

### Photo/Media Sales Foundation

- future only
- may later define media catalog, media order, and delivery entitlement
- not part of first-version booking flow

### Referral Foundation

- future only
- may later define referral code, referral attribution, reward settlement, and invite graph
- separate from first-version traffic source attribution

### Food/Drinks Foundation

- future only
- may later define menu item, cart, onboard fulfillment, and guest order flow
- not part of first-version Telegram booking domain

### Partner Commerce Foundation

- future only
- may later define partner offer, merchant link, partner order, and revenue share mapping
- not part of first-version Telegram booking or ticket flow

## Status Model

### Booking Request Statuses

- `NEW`: request captured, seller action not started
- `ATTRIBUTED`: seller attribution is active
- `CONTACT_IN_PROGRESS`: seller outreach is in progress
- `HOLD_ACTIVE`: temporary hold is active
- `WAITING_PREPAYMENT`: guest is expected to complete prepayment
- `PREPAYMENT_CONFIRMED`: Telegram side has confirmed the trigger to hand off into canonical presale
- `CONFIRMED_TO_PRESALE`: canonical presale exists or is linked
- `GUEST_CANCELLED`: guest cancelled before confirmation
- `HOLD_EXPIRED`: hold expired before confirmation
- `SELLER_NOT_REACHED`: seller follow-up failed or timed out
- `CLOSED_UNCONVERTED`: request finished without confirmed presale

### Hold Statuses

- `ACTIVE`
- `EXTENDED`
- `EXPIRED`
- `RELEASED`
- `CONVERTED`
- `CANCELLED`

### Handoff Execution States

- `queued_for_handoff`: frozen handoff snapshot is queued for isolated execution work
- `handoff_started`: isolated execution work has begun against the frozen snapshot
- `handoff_blocked`: isolated execution work is blocked without creating a canonical presale
- `handoff_consumed`: isolated execution work finished consuming the frozen snapshot without implying production presale creation in this layer

### Ticket-Facing Statuses For Guest Communication

- `REQUEST_RECEIVED`
- `AWAITING_SELLER_CONFIRMATION`
- `AWAITING_PREPAYMENT`
- `PAYMENT_CONFIRMED`
- `TICKET_READY`
- `REMINDER_SENT`
- `BOARDING_READY`
- `USED`
- `CANCELLED`

### Notification Event Types

- `REQUEST_RECEIVED`
- `SELLER_ASSIGNED`
- `HOLD_STARTED`
- `HOLD_EXTENDED`
- `HOLD_EXPIRING`
- `HOLD_EXPIRED`
- `PREPAYMENT_INSTRUCTIONS`
- `PAYMENT_CONFIRMED`
- `TICKET_SENT`
- `REMINDER_SENT`
- `BOARDING_SENT`
- `POST_TRIP_SENT`
- `REVIEW_REQUEST_SENT`
- `REVIEW_RECEIVED`

## First-Version Event Model

The first-version Telegram flow must emit or record at least these event types:

- `SOURCE_ENTRY`
- `SOURCE_BOUND`
- `ATTRIBUTION_STARTED`
- `ATTRIBUTION_EXPIRED`
- `REQUEST_CREATED`
- `HOLD_STARTED`
- `HOLD_EXTENDED`
- `HOLD_EXPIRED`
- `GUEST_CANCELLED`
- `SELLER_NOT_REACHED`
- `PREPAYMENT_CONFIRMED`
- `HANDOFF_PREPARED`
- `HANDOFF_QUEUED`
- `HANDOFF_STARTED`
- `HANDOFF_BLOCKED`
- `HANDOFF_CONSUMED`
- `TICKET_SENT`
- `REMINDER_SENT`
- `BOARDING_SENT`
- `POST_TRIP_SENT`
- `REVIEW_SUBMITTED`

## Event-to-Entity Mapping

- source entry and source binding belong primarily to `GuestEntry`, `TrafficSource`, `SourceQRCode`, and `AnalyticsEvent`
- attribution start and expiry belong primarily to `SellerAttributionSession` and `BookingRequestEvent`
- request creation belongs primarily to `BookingRequest` and `BookingRequestEvent`
- hold start, extension, and expiry belong primarily to `BookingHold` and `BookingRequestEvent`
- guest cancellation and seller-not-reached belong primarily to `BookingRequest` and `BookingRequestEvent`
- prepayment confirmed is the conversion boundary from Telegram domain into canonical presale creation or linking
- handoff prepared, queued, started, blocked, and consumed belong primarily to `BookingRequestEvent` as Telegram-side orchestration history around the frozen handoff snapshot
- ticket sent, reminder sent, boarding sent, and post-trip sent belong primarily to `TelegramNotification`
- review submitted belongs primarily to `AnalyticsEvent` and post-trip follow-up artifacts

## Implementation Notes

- First-version Telegram entities are coordination, communication, attribution, and view-model entities.
- They do not replace the current financial, booking, ticket, or shift-close source-of-truth models.
- Handoff execution state remains a Telegram-side coordination trail until a future bounded integration explicitly creates or links canonical presales.
- Future runtime implementation must preserve current seller, dispatcher, owner, admin, and financial invariants while mapping Telegram conversion only at the prepayment-confirmed boundary.
