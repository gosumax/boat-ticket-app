import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toDataURLMock = vi.fn();
const toStringMock = vi.fn();

vi.mock('qrcode', () => ({
  default: {
    toDataURL: (...args) => toDataURLMock(...args),
    toString: (...args) => toStringMock(...args),
  },
}));

const sourceManagementViewSource = readFileSync(
  new URL('../../src/telegram/AdminTelegramSourceManagementView.jsx', import.meta.url),
  'utf8'
);

describe('telegram source-management qr export action', () => {
  beforeEach(() => {
    toDataURLMock.mockReset();
    toStringMock.mockReset();
  });

  it('builds png qr asset from qr_payload_text for export download', async () => {
    toDataURLMock.mockResolvedValue('data:image/png;base64,AAA');
    const { buildTelegramQrExportDownloadAsset } = await import(
      '../../src/telegram/qr-export-download-utils.js'
    );

    const result = await buildTelegramQrExportDownloadAsset(
      {
        printable_exportable_payload_summary: {
          start_command_payload: '/start seller-maxim-1',
          qr_payload_text: 'telegram_start_source:seller-qr-export-123',
        },
      },
      { format: 'png' }
    );

    expect(result).toEqual({
      fileExtension: 'png',
      dataUrl: 'data:image/png;base64,AAA',
    });
    expect(toDataURLMock).toHaveBeenCalledWith(
      'https://t.me/seawalk_bot?start=seller-maxim-1',
      expect.objectContaining({ type: 'image/png' })
    );
  });

  it('builds svg qr asset for fallback usage and keeps promo/manual payload support', async () => {
    toStringMock.mockResolvedValue('<svg>promo</svg>');
    const { buildTelegramQrExportDownloadAsset } = await import(
      '../../src/telegram/qr-export-download-utils.js'
    );

    const result = await buildTelegramQrExportDownloadAsset(
      {
        printable_exportable_payload_summary: {
          start_command_payload: '/start promo-main-1',
          qr_payload_text: 'telegram_start_source:promo-qr-export-55',
        },
      },
      { format: 'svg' }
    );

    expect(result.fileExtension).toBe('svg');
    expect(result.dataUrl).toContain('data:image/svg+xml');
    expect(toStringMock).toHaveBeenCalledWith(
      'https://t.me/seawalk_bot?start=promo-main-1',
      expect.objectContaining({ type: 'svg' })
    );
  });

  it('falls back to source reference when payload has no start token', async () => {
    toDataURLMock.mockResolvedValue('data:image/png;base64,BBB');
    const { buildTelegramQrExportDownloadAsset } = await import(
      '../../src/telegram/qr-export-download-utils.js'
    );

    await buildTelegramQrExportDownloadAsset(
      {
        printable_exportable_payload_summary: {
          qr_payload_text: '',
        },
      },
      { format: 'png', sourceReference: 'seller-maxim-1' }
    );

    expect(toDataURLMock).toHaveBeenCalledWith(
      'https://t.me/seawalk_bot?start=seller-maxim-1',
      expect.objectContaining({ type: 'image/png' })
    );
  });

  it('returns null when qr summary misses required payload fields', async () => {
    const { buildTelegramQrExportDownloadAsset } = await import(
      '../../src/telegram/qr-export-download-utils.js'
    );
    expect(
      await buildTelegramQrExportDownloadAsset(
        {
          printable_exportable_payload_summary: {
            qr_payload_text: '',
          },
        },
        { format: 'png', sourceReference: null }
      )
    ).toBe(null);
  });

  it('normalizes export file names to real qr extensions', async () => {
    const { resolveQrExportFileName } = await import(
      '../../src/telegram/qr-export-download-utils.js'
    );

    expect(
      resolveQrExportFileName(
        {
          printable_exportable_payload_summary: {
            export_file_name: 'promo-main-1.telegram-qr.txt',
          },
        },
        'promo-main-1',
        'png'
      )
    ).toBe('promo-main-1.telegram-qr.png');
    expect(
      resolveQrExportFileName(
        {
          printable_exportable_payload_summary: {
            export_file_name: 'promo-main-1.telegram-qr.txt',
          },
        },
        'promo-main-1',
        'svg'
      )
    ).toBe('promo-main-1.telegram-qr.svg');
  });

  it('keeps button flow wired to qr asset generation and download trigger', () => {
    expect(sourceManagementViewSource).toMatch(
      /let payloadItem = model\.selectedQrPayloadItem \|\| null/
    );
    expect(sourceManagementViewSource).toMatch(
      /buildTelegramQrExportDownloadAsset\(payloadItem, \{\s*format: 'png',\s*sourceReference: selectedSourceReferenceValue,\s*\}\)/
    );
    expect(sourceManagementViewSource).toMatch(
      /buildTelegramQrExportDownloadAsset\(payloadItem, \{\s*format: 'svg',\s*sourceReference: selectedSourceReferenceValue,\s*\}\)/
    );
    expect(sourceManagementViewSource).toMatch(
      /const downloadStarted = triggerQrAssetDownload\(fileName, asset\)/
    );
    expect(sourceManagementViewSource).toMatch(/resolveTelegramDeepLinkForPayload/);
    expect(sourceManagementViewSource).toMatch(
      /disabled=\{!selectedSourceReferenceValue \|\| isQrLoading\}/
    );
  });
});
  it('resolves deep link by start token for promo/seller payloads', async () => {
    const { resolveTelegramDeepLinkForPayload } = await import(
      '../../src/telegram/qr-export-download-utils.js'
    );

    expect(
      resolveTelegramDeepLinkForPayload(
        {
          printable_exportable_payload_summary: {
            start_command_payload: '/start promo-main-1',
          },
        },
        'fallback-ref'
      )
    ).toBe('https://t.me/seawalk_bot?start=promo-main-1');
    expect(
      resolveTelegramDeepLinkForPayload(
        {
          printable_exportable_payload_summary: {
            start_command_payload: '/start seller-maxim-1',
          },
        },
        'fallback-ref'
      )
    ).toBe('https://t.me/seawalk_bot?start=seller-maxim-1');
  });
