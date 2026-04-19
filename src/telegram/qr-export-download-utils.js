import QRCode from 'qrcode';

const TELEGRAM_QR_EXPORT_BOT_USERNAME = 'seawalk_bot';

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function resolveFileBaseName(payloadItem, sourceReference = null) {
  const payloadFileName = normalizeString(
    payloadItem?.printable_exportable_payload_summary?.export_file_name
  );
  const fallbackReference = normalizeString(sourceReference) || 'telegram_source';
  const rawFileName = payloadFileName || `${fallbackReference}.telegram-qr.txt`;
  const sanitized = rawFileName.replace(/[\\/:*?"<>|]+/g, '_');
  return sanitized.replace(/\.(txt|png|svg)$/i, '');
}

export function resolveQrExportFileName(
  payloadItem,
  sourceReference = null,
  fileExtension = 'png'
) {
  const normalizedExtension = normalizeString(fileExtension) || 'png';
  return `${resolveFileBaseName(payloadItem, sourceReference)}.${normalizedExtension}`;
}

export function resolveQrPayloadText(payloadItem) {
  return normalizeString(payloadItem?.printable_exportable_payload_summary?.qr_payload_text);
}

function extractStartTokenFromStartCommand(payloadItem) {
  const startCommandPayload = normalizeString(
    payloadItem?.printable_exportable_payload_summary?.start_command_payload
  );
  if (!startCommandPayload) {
    return null;
  }
  const match = startCommandPayload.match(/^\/start\s+(.+)$/i);
  return normalizeString(match?.[1]);
}

function extractStartTokenFromRawQrPayload(payloadItem) {
  const qrPayloadText = resolveQrPayloadText(payloadItem);
  if (!qrPayloadText) {
    return null;
  }
  const match = qrPayloadText.match(/^telegram_start_source:(.+)$/i);
  return normalizeString(match?.[1]);
}

export function resolveTelegramDeepLinkForPayload(payloadItem, sourceReference = null) {
  const startToken =
    extractStartTokenFromStartCommand(payloadItem) ||
    extractStartTokenFromRawQrPayload(payloadItem) ||
    normalizeString(sourceReference);
  if (!startToken) {
    return null;
  }
  return `https://t.me/${TELEGRAM_QR_EXPORT_BOT_USERNAME}?start=${encodeURIComponent(startToken)}`;
}

export async function buildTelegramQrExportDownloadAsset(
  payloadItem,
  { format = 'png', width = 768, margin = 2, sourceReference = null } = {}
) {
  const deepLink = resolveTelegramDeepLinkForPayload(payloadItem, sourceReference);
  if (!deepLink) {
    return null;
  }

  const normalizedFormat = String(format || 'png').toLowerCase();
  if (normalizedFormat === 'svg') {
    const svgMarkup = await QRCode.toString(deepLink, {
      type: 'svg',
      width,
      margin,
      errorCorrectionLevel: 'M',
    });
    return {
      fileExtension: 'svg',
      dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`,
    };
  }

  const pngDataUrl = await QRCode.toDataURL(deepLink, {
    type: 'image/png',
    width,
    margin,
    errorCorrectionLevel: 'M',
  });
  return {
    fileExtension: 'png',
    dataUrl: pngDataUrl,
  };
}

export function triggerQrAssetDownload(fileName, asset) {
  if (!fileName || !asset?.dataUrl || typeof document === 'undefined') {
    return false;
  }

  const anchor = document.createElement('a');
  anchor.href = asset.dataUrl;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  return true;
}
