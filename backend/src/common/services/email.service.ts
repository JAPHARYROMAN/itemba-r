import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      this.logger.warn('SMTP_HOST is not configured — email sending is disabled');
      return;
    }
    this.transporter = nodemailer.createTransport({
      host,
      port: this.config.get<number>('SMTP_PORT') ?? 587,
      secure: this.config.get<string>('SMTP_SECURE') === 'true',
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    });
  }

  async sendEmail(to: string, subject: string, html: string, text?: string): Promise<void> {
    await this.deliver(to, subject, html, text);
  }

  async sendEmailWithAttachments(
    to: string,
    subject: string,
    html: string,
    text: string | undefined,
    attachments: EmailAttachment[],
    cc: string[] = [],
  ): Promise<boolean> {
    return this.deliver(to, subject, html, text, attachments, cc);
  }

  private async deliver(
    to: string,
    subject: string,
    html: string,
    text?: string,
    attachments: EmailAttachment[] = [],
    cc: string[] = [],
  ): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn(`Email skipped (SMTP not configured): "${subject}" to ${to}`);
      return false;
    }
    try {
      const from = this.config.get<string>('SMTP_FROM') ?? 'ITEMBA-R System <noreply@itemba-r.com>';
      await this.transporter.sendMail({
        from,
        to,
        ...(cc.length && { cc }),
        subject,
        html,
        text,
        ...(attachments.length && { attachments }),
      });
      this.logger.log(`Email sent: "${subject}" to ${to}`);
      return true;
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${(err as Error).message}`, (err as Error).stack);
      return false;
    }
  }

  async sendPasswordReset(to: string, name: string, resetUrl: string): Promise<void> {
    const subject = 'Reset your ITEMBA-R password';
    const html = `
      <p>Hello ${name},</p>
      <p>You requested a password reset. Click the link below to set a new password:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link expires in 1 hour. If you did not request this, ignore this email.</p>
    `;
    const text = `Hello ${name},\n\nReset your password: ${resetUrl}\n\nThis link expires in 1 hour.`;
    await this.sendEmail(to, subject, html, text);
  }

  async sendWelcome(to: string, name: string): Promise<void> {
    const subject = 'Welcome to ITEMBA-R';
    const html = `
      <p>Hello ${name},</p>
      <p>Welcome to ITEMBA-R! Your account has been created successfully.</p>
      <p>You can now log in and start using the platform.</p>
    `;
    const text = `Hello ${name},\n\nWelcome to ITEMBA-R! Your account has been created successfully.`;
    await this.sendEmail(to, subject, html, text);
  }

  async sendApprovalNotification(
    to: string,
    name: string,
    entityType: string,
    entityId: string,
    action: string,
  ): Promise<void> {
    const subject = `Approval ${action}: ${entityType}`;
    const html = `
      <p>Hello ${name},</p>
      <p>The ${entityType} (ID: ${entityId}) has been <strong>${action}</strong>.</p>
    `;
    const text = `Hello ${name},\n\nThe ${entityType} (ID: ${entityId}) has been ${action}.`;
    await this.sendEmail(to, subject, html, text);
  }

  async sendPayrollReady(to: string, name: string, period: string, amount: number): Promise<void> {
    const subject = `Payroll Ready: ${period}`;
    const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
    const html = `
      <p>Hello ${name},</p>
      <p>Your payroll for <strong>${period}</strong> is ready. Net amount: <strong>${formatted}</strong>.</p>
    `;
    const text = `Hello ${name},\n\nYour payroll for ${period} is ready. Net amount: ${formatted}.`;
    await this.sendEmail(to, subject, html, text);
  }
}
