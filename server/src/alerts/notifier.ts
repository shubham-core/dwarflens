import { db } from '../db/client.js';
import { users, orgMembers } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { env } from '../env.js';

export interface AlertNotificationParams {
  project: {
    id: string;
    name: string;
    repo: string;
    orgId: string;
    settings?: Record<string, unknown> | null;
  };
  analysis: {
    id: string;
    commitSha: string;
    branch: string;
    buildName: string;
    totalSize: number;
  };
  reasons: string[];
}

export interface AlertResult {
  slackSent: boolean;
  emailSent: boolean;
  errors: string[];
}

export async function sendBudgetAlerts(params: AlertNotificationParams): Promise<AlertResult> {
  const { project, analysis, reasons } = params;
  const result: AlertResult = { slackSent: false, emailSent: false, errors: [] };

  // Only alert on main branch as per requirement: "Send an email (Resend) when a budget fails on the main branch."
  const isMainBranch =
    analysis.branch === 'main' ||
    analysis.branch === 'master' ||
    analysis.branch.endsWith('/main') ||
    analysis.branch.endsWith('/master');

  if (!isMainBranch) {
    return result;
  }

  const alertSettings = (project.settings as Record<string, any>)?.alerts;

  // 1. Slack incoming webhook notification
  const slackUrl = alertSettings?.slack_webhook_url;
  const slackRegex = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9+/_-]+$/;
  if (slackUrl && typeof slackUrl === 'string' && slackRegex.test(slackUrl)) {
    try {
      const slackPayload = {
        text: `🚨 *DwarfLens Budget Violation Detected*\n*Project:* ${project.name} (\`${project.repo}\`)\n*Branch:* \`${analysis.branch}\`\n*Commit:* \`${analysis.commitSha.slice(0, 7)}\`\n*Build:* ${analysis.buildName}\n*Violations:*\n${reasons.map((r) => `• ${r}`).join('\n')}`,
      };
      const res = await fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackPayload),
      });

      if (res.ok) {
        result.slackSent = true;
      } else {
        const errorText = await res.text().catch(() => '');
        result.errors.push(`Slack webhook failed: HTTP ${res.status} ${errorText}`);
      }
    } catch (err: any) {
      result.errors.push(`Slack webhook error: ${err.message}`);
    }
  }

  // 2. Resend email alert (only send to verified org members)
  const resendApiKey = env.RESEND_API_KEY;
  if (resendApiKey) {
    try {
      let recipientEmail = alertSettings?.email;
      if (!recipientEmail) {
        // Query org owner's email address (only verified)
        const [ownerMembership] = await db
          .select({ email: users.email })
          .from(orgMembers)
          .innerJoin(users, eq(orgMembers.userId, users.id))
          .where(and(eq(orgMembers.orgId, project.orgId), eq(orgMembers.role, 'owner'), eq(users.emailVerified, true)))
          .limit(1);

        recipientEmail = ownerMembership?.email;
      } else {
        // Custom email must belong to a verified org member
        const [verifiedMember] = await db
          .select({ email: users.email })
          .from(orgMembers)
          .innerJoin(users, eq(orgMembers.userId, users.id))
          .where(and(eq(orgMembers.orgId, project.orgId), eq(users.email, recipientEmail), eq(users.emailVerified, true)))
          .limit(1);

        if (!verifiedMember) {
          result.errors.push(`Skipped email alert: ${recipientEmail} is not a verified organization member`);
          recipientEmail = undefined;
        }
      }

      if (recipientEmail) {
        const emailSubject = `❌ DwarfLens Budget Failed: ${project.name} (${analysis.branch})`;
        const emailBody = `DwarfLens CI detected budget violations on branch "${analysis.branch}" for project ${project.name} (${project.repo}).

Commit: ${analysis.commitSha}
Build: ${analysis.buildName}
Total Binary Size: ${analysis.totalSize.toLocaleString()} B

Failure Reasons:
${reasons.map((r) => `- ${r}`).join('\n')}

View project analyses:
${env.APP_URL}/#projects/${project.id}
`;

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: 'DwarfLens Alerts <alerts@dwarflens.dev>',
            to: [recipientEmail],
            subject: emailSubject,
            text: emailBody,
          }),
        });

        if (res.ok) {
          result.emailSent = true;
        } else {
          const errorText = await res.text().catch(() => '');
          result.errors.push(`Resend email failed: HTTP ${res.status} ${errorText}`);
        }
      }
    } catch (err: any) {
      result.errors.push(`Resend email error: ${err.message}`);
    }
  }

  return result;
}
