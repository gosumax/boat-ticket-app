import {
  buildTelegramHandoffTimestampSummary,
  buildTelegramLatestTimestampSummary,
  freezeTelegramServiceMessageTemplateValue,
  TELEGRAM_SERVICE_MESSAGE_TEMPLATE_BASELINES,
  TELEGRAM_SERVICE_MESSAGE_TEMPLATE_ITEM_VERSION,
  TELEGRAM_SERVICE_MESSAGE_TEMPLATE_LIST_VERSION,
  TELEGRAM_SERVICE_MESSAGE_TEMPLATE_MUTATION_VERSION,
  TELEGRAM_SERVICE_MESSAGE_TEMPLATE_TYPES,
} from '../../../shared/telegram/index.js';

const ERROR_PREFIX = '[TELEGRAM_SERVICE_MESSAGE_TEMPLATE]';
const SERVICE_NAME = 'telegram_service_message_template_management_service';
const TEMPLATE_GROUP = 'service_message_template';
const TEMPLATE_CONTENT_TYPE = 'service_content_block';
const TEMPLATE_REFERENCE_RE = /^[A-Za-z0-9_-]+$/;

function rejectTemplate(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return Boolean(fallback);
  }
  if (value === true || value === false) {
    return value;
  }
  if (value === 1 || value === 0) {
    return value === 1;
  }
  rejectTemplate('enabled state must be boolean-compatible');
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectTemplate(`${label} must be a positive integer`);
  }
  return normalized;
}

function normalizeTemplateType(value) {
  const normalized = normalizeString(value);
  if (!normalized || !TELEGRAM_SERVICE_MESSAGE_TEMPLATE_TYPES.includes(normalized)) {
    rejectTemplate(`invalid template type: ${normalized || 'unknown'}`);
  }
  return normalized;
}

function buildExpectedTemplateReference(templateType) {
  return `tg_service_message_template_${templateType}`;
}

function normalizeTemplateReference(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    rejectTemplate('template reference is required');
  }
  if (!TEMPLATE_REFERENCE_RE.test(normalized)) {
    rejectTemplate(
      'template reference must contain only letters, numbers, underscores, or hyphens'
    );
  }
  return normalized;
}

function normalizeTitle(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    rejectTemplate('title/name summary is required');
  }
  return normalized;
}

function normalizeBody(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    rejectTemplate('text/body summary is required');
  }
  return normalized;
}

function normalizeReferenceInput(input = {}) {
  if (typeof input === 'string') {
    return normalizeTemplateReference(input);
  }
  if (!isPlainObject(input)) {
    rejectTemplate('template reference is required');
  }
  return normalizeTemplateReference(
    input.template_reference ?? input.templateReference ?? input.reference
  );
}

function buildTemplateSummary(row) {
  const templateType = normalizeString(row.visibility_action_summary?.template_type);
  return freezeTelegramServiceMessageTemplateValue({
    template_reference: row.content_reference,
    template_type: templateType,
    title_name_summary: freezeTelegramServiceMessageTemplateValue({
      title_name: row.title_summary,
    }),
    text_body_summary: freezeTelegramServiceMessageTemplateValue({
      text_body: row.short_text_summary,
    }),
    enabled_state_summary: freezeTelegramServiceMessageTemplateValue({
      enabled: Boolean(row.is_enabled),
    }),
    version_summary: freezeTelegramServiceMessageTemplateValue({
      template_version: row.content_version,
      is_latest_version: Boolean(row.is_latest_version),
    }),
    latest_timestamp_summary: buildTelegramHandoffTimestampSummary(
      row.updated_at || row.created_at
    ),
  });
}

function buildCreateComparable(input) {
  return freezeTelegramServiceMessageTemplateValue({
    template_reference: input.template_reference,
    template_type: input.template_type,
    title_name_summary: input.title_name_summary,
    text_body_summary: input.text_body_summary,
    enabled: Boolean(input.enabled),
  });
}

function comparableEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeCreateInput(input = {}) {
  if (!isPlainObject(input)) {
    rejectTemplate('service-message template create payload must be an object');
  }

  const templateType = normalizeTemplateType(
    input.template_type ?? input.templateType
  );
  const expectedReference = buildExpectedTemplateReference(templateType);
  const explicitReferenceRaw = input.template_reference ?? input.templateReference;
  const templateReference = explicitReferenceRaw
    ? normalizeTemplateReference(explicitReferenceRaw)
    : expectedReference;
  if (templateReference !== expectedReference) {
    rejectTemplate(`incompatible template reference/type: ${templateReference}/${templateType}`);
  }

  return freezeTelegramServiceMessageTemplateValue({
    template_reference: templateReference,
    template_type: templateType,
    title_name_summary: normalizeTitle(
      input.title_name_summary ?? input.titleNameSummary ?? input.title_summary ?? input.title
    ),
    text_body_summary: normalizeBody(
      input.text_body_summary ?? input.textBodySummary ?? input.body_summary ?? input.body
    ),
    enabled: normalizeBoolean(
      input.enabled ?? input.is_enabled ?? input.isEnabled,
      true
    ),
  });
}

function normalizeUpdateInput(input = {}) {
  if (!isPlainObject(input)) {
    rejectTemplate('service-message template update payload must be an object');
  }
  const templateReference = normalizeReferenceInput(input);
  const expectedVersionRaw = input.expected_version ?? input.expectedVersion;
  const expectedVersion =
    expectedVersionRaw === null ||
    expectedVersionRaw === undefined ||
    expectedVersionRaw === ''
      ? null
      : normalizePositiveInteger(expectedVersionRaw, 'expected_version');
  const patch = {};
  const hasTitle =
    input.title_name_summary !== undefined ||
    input.titleNameSummary !== undefined ||
    input.title_summary !== undefined ||
    input.title !== undefined;
  const hasBody =
    input.text_body_summary !== undefined ||
    input.textBodySummary !== undefined ||
    input.body_summary !== undefined ||
    input.body !== undefined;
  const hasEnabled =
    input.enabled !== undefined ||
    input.is_enabled !== undefined ||
    input.isEnabled !== undefined;
  const hasTemplateType =
    input.template_type !== undefined ||
    input.templateType !== undefined;

  if (hasTitle) {
    patch.title_name_summary = normalizeTitle(
      input.title_name_summary ??
        input.titleNameSummary ??
        input.title_summary ??
        input.title
    );
  }
  if (hasBody) {
    patch.text_body_summary = normalizeBody(
      input.text_body_summary ??
        input.textBodySummary ??
        input.body_summary ??
        input.body
    );
  }
  if (hasEnabled) {
    patch.enabled = normalizeBoolean(
      input.enabled ?? input.is_enabled ?? input.isEnabled
    );
  }
  if (hasTemplateType) {
    patch.template_type = normalizeTemplateType(
      input.template_type ?? input.templateType
    );
  }
  if (Object.keys(patch).length === 0) {
    rejectTemplate('service-message template update patch is empty');
  }

  return freezeTelegramServiceMessageTemplateValue({
    template_reference: templateReference,
    expected_version: expectedVersion,
    patch,
  });
}

function normalizeListInput(input = {}) {
  if (input === null || input === undefined) {
    return freezeTelegramServiceMessageTemplateValue({
      template_type: null,
      enabled: null,
    });
  }
  if (!isPlainObject(input)) {
    rejectTemplate('service-message template list input must be an object');
  }
  const templateTypeRaw = input.template_type ?? input.templateType;
  const enabledRaw = input.enabled ?? input.is_enabled ?? input.isEnabled;
  return freezeTelegramServiceMessageTemplateValue({
    template_type:
      templateTypeRaw === undefined || templateTypeRaw === null || templateTypeRaw === ''
        ? null
        : normalizeTemplateType(templateTypeRaw),
    enabled:
      enabledRaw === undefined || enabledRaw === null || enabledRaw === ''
        ? null
        : normalizeBoolean(enabledRaw),
  });
}

function normalizeEnableInput(input = {}, enabledValue = undefined) {
  if (enabledValue !== undefined) {
    return freezeTelegramServiceMessageTemplateValue({
      template_reference: normalizeReferenceInput(input),
      enabled: normalizeBoolean(enabledValue),
      expected_version:
        input.expected_version === undefined && input.expectedVersion === undefined
          ? null
          : normalizePositiveInteger(
              input.expected_version ?? input.expectedVersion,
              'expected_version'
            ),
    });
  }
  if (!isPlainObject(input)) {
    rejectTemplate('service-message template enable/disable payload must be an object');
  }
  return freezeTelegramServiceMessageTemplateValue({
    template_reference: normalizeReferenceInput(input),
    enabled: normalizeBoolean(input.enabled ?? input.is_enabled ?? input.isEnabled),
    expected_version:
      input.expected_version === undefined && input.expectedVersion === undefined
        ? null
        : normalizePositiveInteger(
            input.expected_version ?? input.expectedVersion,
            'expected_version'
          ),
  });
}

export class TelegramServiceMessageTemplateManagementService {
  constructor({
    managedContentItems,
    now = () => new Date(),
  }) {
    this.managedContentItems = managedContentItems;
    this.now = now;
    this._baselineSeeded = false;
  }

  describe() {
    return Object.freeze({
      serviceName: SERVICE_NAME,
      status: 'telegram_service_message_template_management_ready',
      dependencyKeys: ['managedContentItems'],
    });
  }

  get db() {
    return this.managedContentItems?.db || null;
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectTemplate('service-message template clock returned an unusable timestamp');
    }
    return iso;
  }

  ensureBaselineSeeded() {
    if (this._baselineSeeded || !this.managedContentItems?.db) {
      return;
    }

    const runSeed = () => {
      for (const item of TELEGRAM_SERVICE_MESSAGE_TEMPLATE_BASELINES) {
        const existing = this.managedContentItems.findOneBy(
          {
            content_reference: item.template_reference,
            is_latest_version: 1,
          },
          { orderBy: 'content_version DESC' }
        );
        if (existing) {
          continue;
        }
        const nowIso = this.nowIso();
        this.managedContentItems.create({
          content_reference: item.template_reference,
          content_group: TEMPLATE_GROUP,
          content_type: TEMPLATE_CONTENT_TYPE,
          title_summary: item.title_name_summary,
          short_text_summary: item.text_body_summary,
          visibility_action_summary: {
            template_type: item.template_type,
            template_reference: item.template_reference,
          },
          is_enabled: 1,
          content_version: 1,
          is_latest_version: 1,
          versioned_from_item_id: null,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }
    };

    if (typeof this.db?.transaction === 'function') {
      this.db.transaction(runSeed)();
    } else {
      runSeed();
    }
    this._baselineSeeded = true;
  }

  resolveLatestRowByReference(referenceInput) {
    const templateReference = normalizeReferenceInput(referenceInput);
    const row = this.managedContentItems.findOneBy(
      {
        content_reference: templateReference,
        content_group: TEMPLATE_GROUP,
        is_latest_version: 1,
      },
      { orderBy: 'content_version DESC' }
    );
    if (!row) {
      rejectTemplate(`invalid template reference: ${templateReference}`);
    }
    return row;
  }

  listLatestRows() {
    return this.managedContentItems.listBy(
      {
        content_group: TEMPLATE_GROUP,
        is_latest_version: 1,
      },
      { orderBy: 'content_reference ASC', limit: 500 }
    );
  }

  assertVersionOrThrow(row, expectedVersion) {
    if (expectedVersion === null || expectedVersion === undefined) {
      return;
    }
    if (Number(row.content_version) !== Number(expectedVersion)) {
      rejectTemplate(
        `version conflict for template reference ${row.content_reference}: expected ${expectedVersion}, got ${row.content_version}`
      );
    }
  }

  buildItemResult(row, responseVersion = TELEGRAM_SERVICE_MESSAGE_TEMPLATE_ITEM_VERSION) {
    return freezeTelegramServiceMessageTemplateValue({
      response_version: responseVersion,
      read_only: true,
      projected_by: SERVICE_NAME,
      service_message_template: buildTemplateSummary(row),
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        this.nowIso(),
        row.updated_at,
        row.created_at
      ),
    });
  }

  buildMutationResult(row, operation) {
    return freezeTelegramServiceMessageTemplateValue({
      response_version: TELEGRAM_SERVICE_MESSAGE_TEMPLATE_MUTATION_VERSION,
      persistence_applied: true,
      operation,
      processed_by: SERVICE_NAME,
      service_message_template: buildTemplateSummary(row),
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        this.nowIso(),
        row.updated_at,
        row.created_at
      ),
    });
  }

  listServiceMessageTemplates(input = {}) {
    this.ensureBaselineSeeded();
    const filters = normalizeListInput(input);
    let rows = this.listLatestRows();
    if (filters.template_type) {
      rows = rows.filter(
        (row) =>
          normalizeString(row.visibility_action_summary?.template_type) ===
          filters.template_type
      );
    }
    if (filters.enabled !== null) {
      rows = rows.filter((row) => Boolean(row.is_enabled) === filters.enabled);
    }
    const items = rows.map((row) => buildTemplateSummary(row));
    return freezeTelegramServiceMessageTemplateValue({
      response_version: TELEGRAM_SERVICE_MESSAGE_TEMPLATE_LIST_VERSION,
      read_only: true,
      projected_by: SERVICE_NAME,
      template_type_filter_summary: filters.template_type,
      enabled_filter_summary: filters.enabled,
      item_count: items.length,
      items,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        this.nowIso(),
        ...items.map((item) => item.latest_timestamp_summary?.iso)
      ),
    });
  }

  readServiceMessageTemplateByReference(input = {}) {
    this.ensureBaselineSeeded();
    return this.buildItemResult(this.resolveLatestRowByReference(input));
  }

  createServiceMessageTemplate(input = {}) {
    this.ensureBaselineSeeded();
    const normalized = normalizeCreateInput(input);
    const existingByReference = this.managedContentItems.findOneBy(
      {
        content_reference: normalized.template_reference,
        content_group: TEMPLATE_GROUP,
        is_latest_version: 1,
      },
      { orderBy: 'content_version DESC' }
    );
    const existingByType = this.listLatestRows().find(
      (row) =>
        normalizeString(row.visibility_action_summary?.template_type) ===
        normalized.template_type
    );
    const existing = existingByReference || existingByType || null;
    if (existing) {
      const existingComparable = buildCreateComparable({
        template_reference: existing.content_reference,
        template_type: normalizeString(existing.visibility_action_summary?.template_type),
        title_name_summary: existing.title_summary,
        text_body_summary: existing.short_text_summary,
        enabled: Boolean(existing.is_enabled),
      });
      if (comparableEqual(existingComparable, buildCreateComparable(normalized))) {
        return this.buildMutationResult(existing, 'idempotent_create');
      }
      rejectTemplate(
        `duplicate incompatible template payload for type/reference: ${normalized.template_type}/${normalized.template_reference}`
      );
    }

    const nowIso = this.nowIso();
    const created = this.managedContentItems.create({
      content_reference: normalized.template_reference,
      content_group: TEMPLATE_GROUP,
      content_type: TEMPLATE_CONTENT_TYPE,
      title_summary: normalized.title_name_summary,
      short_text_summary: normalized.text_body_summary,
      visibility_action_summary: {
        template_type: normalized.template_type,
        template_reference: normalized.template_reference,
      },
      is_enabled: normalized.enabled ? 1 : 0,
      content_version: 1,
      is_latest_version: 1,
      versioned_from_item_id: null,
      created_at: nowIso,
      updated_at: nowIso,
    });
    return this.buildMutationResult(created, 'created');
  }

  updateServiceMessageTemplateVersionSafe(input = {}) {
    this.ensureBaselineSeeded();
    const normalized = normalizeUpdateInput(input);

    const runUpdate = () => {
      const current = this.resolveLatestRowByReference({
        template_reference: normalized.template_reference,
      });
      this.assertVersionOrThrow(current, normalized.expected_version);

      const currentTemplateType = normalizeString(
        current.visibility_action_summary?.template_type
      );
      if (
        normalized.patch.template_type &&
        normalized.patch.template_type !== currentTemplateType
      ) {
        rejectTemplate(
          `incompatible template payload for type/reference: ${normalized.patch.template_type}/${normalized.template_reference}`
        );
      }

      const nextState = buildCreateComparable({
        template_reference: current.content_reference,
        template_type: currentTemplateType,
        title_name_summary:
          normalized.patch.title_name_summary !== undefined
            ? normalized.patch.title_name_summary
            : current.title_summary,
        text_body_summary:
          normalized.patch.text_body_summary !== undefined
            ? normalized.patch.text_body_summary
            : current.short_text_summary,
        enabled:
          normalized.patch.enabled !== undefined
            ? normalized.patch.enabled
            : Boolean(current.is_enabled),
      });
      const currentState = buildCreateComparable({
        template_reference: current.content_reference,
        template_type: currentTemplateType,
        title_name_summary: current.title_summary,
        text_body_summary: current.short_text_summary,
        enabled: Boolean(current.is_enabled),
      });
      if (comparableEqual(currentState, nextState)) {
        return current;
      }

      this.managedContentItems.updateById(current.telegram_managed_content_item_id, {
        is_latest_version: 0,
        updated_at: this.nowIso(),
      });
      const nowIso = this.nowIso();
      return this.managedContentItems.create({
        content_reference: current.content_reference,
        content_group: TEMPLATE_GROUP,
        content_type: TEMPLATE_CONTENT_TYPE,
        title_summary: nextState.title_name_summary,
        short_text_summary: nextState.text_body_summary,
        visibility_action_summary: {
          template_type: currentTemplateType,
          template_reference: current.content_reference,
        },
        is_enabled: nextState.enabled ? 1 : 0,
        content_version: Number(current.content_version) + 1,
        is_latest_version: 1,
        versioned_from_item_id: current.telegram_managed_content_item_id,
        created_at: nowIso,
        updated_at: nowIso,
      });
    };

    const updated =
      typeof this.db?.transaction === 'function'
        ? this.db.transaction(runUpdate)()
        : runUpdate();
    return this.buildMutationResult(updated, 'updated_version_safe');
  }

  setServiceMessageTemplateEnabledState(input = {}, enabledValue = undefined) {
    const normalized = normalizeEnableInput(input, enabledValue);
    return this.updateServiceMessageTemplateVersionSafe({
      template_reference: normalized.template_reference,
      expected_version: normalized.expected_version,
      enabled: normalized.enabled,
    });
  }

  enableServiceMessageTemplate(input = {}) {
    return this.setServiceMessageTemplateEnabledState(input, true);
  }

  disableServiceMessageTemplate(input = {}) {
    return this.setServiceMessageTemplateEnabledState(input, false);
  }
}
