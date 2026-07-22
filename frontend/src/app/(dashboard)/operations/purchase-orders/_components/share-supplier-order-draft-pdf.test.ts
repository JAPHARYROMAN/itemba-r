import { describe, expect, it } from 'vitest';
import {
  emailShareUrl,
  normalizeWhatsAppPhone,
  whatsappShareUrl,
} from './share-supplier-order-draft-pdf';

describe('supplier order draft share helpers', () => {
  it('normalizes common Tanzanian phone formats for WhatsApp', () => {
    expect(normalizeWhatsAppPhone('+255 758 793 511')).toBe('255758793511');
    expect(normalizeWhatsAppPhone('0758 793 511')).toBe('255758793511');
    expect(normalizeWhatsAppPhone('758793511')).toBe('255758793511');
  });

  it('builds an encoded WhatsApp message for a selected recipient', () => {
    const url = whatsappShareUrl('0758793511', 'Please review SOD-001 & confirm.');
    expect(url).toContain('https://wa.me/255758793511?text=');
    expect(decodeURIComponent(url)).toContain('Please review SOD-001 & confirm.');
  });

  it('builds an email fallback with recipient, cc, subject, and body', () => {
    const url = emailShareUrl({
      to: 'supplier@example.com',
      cc: 'accounts@example.com',
      subject: 'Supplier Order Draft',
      message: 'Please review.',
    });
    expect(url).toContain('mailto:supplier%40example.com?');
    expect(url).toContain('cc=accounts%40example.com');
    expect(url).toContain('subject=Supplier+Order+Draft');
  });
});
