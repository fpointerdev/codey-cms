import type { BackupHealth } from "../../infrastructure/operations/backup-status.js";

export type LaunchReadinessCheck = {
  id: string;
  label: string;
  status: "pass" | "action" | "blocked";
  message: string;
  settingsTab?: "general" | "email" | "updates" | "security";
};

type LaunchReadinessInput = {
  publicUrl?: string;
  siteUrl?: string;
  searchIndexing: boolean;
  sitemapEnabled: boolean;
  metaDescription?: string;
  storageDriver: "disabled" | "local" | "s3";
  email: {
    configured: boolean;
    recoveryEnabled: boolean;
    lastTestSucceeded?: boolean;
  };
  backup: BackupHealth;
  ownerMfaEnabled: boolean;
  updatesEnabled: boolean;
};

function parsedUrl(value?: string) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

function isLocalHostname(hostname: string) {
  return ["localhost", "127.0.0.1", "::1"].includes(hostname);
}

export function buildLaunchReadiness(input: LaunchReadinessInput) {
  const publicUrl = parsedUrl(input.publicUrl);
  const siteUrl = parsedUrl(input.siteUrl);
  const publicTarget = Boolean(publicUrl && !isLocalHostname(publicUrl.hostname));
  const checks: LaunchReadinessCheck[] = [];

  checks.push(publicUrl && (!publicTarget || publicUrl.protocol === "https:")
    ? {
        id: "public-url",
        label: publicTarget ? "Secure public address" : "Local address",
        status: "pass",
        message: publicTarget ? "The runtime uses an HTTPS public address." : "The runtime is configured for local use."
      }
    : {
        id: "public-url",
        label: "Secure public address",
        status: "blocked",
        message: "Configure the final HTTPS website address before publishing.",
        settingsTab: "general"
      });

  const canonicalMatches = Boolean(publicUrl && siteUrl && publicUrl.origin === siteUrl.origin);
  const searchReady = canonicalMatches && (!input.searchIndexing || input.sitemapEnabled);
  checks.push(searchReady
    ? {
        id: "seo",
        label: "Search and sharing",
        status: "pass",
        message: input.searchIndexing && input.sitemapEnabled
          ? "Canonical URLs, indexing, and the sitemap are enabled."
          : "Canonical URLs are configured for this private or non-indexed site."
      }
    : {
        id: "seo",
        label: "Search and sharing",
        status: publicTarget ? "blocked" : "action",
        message: canonicalMatches
          ? "Enable the sitemap before allowing search indexing."
          : "Set the canonical site URL to the same public origin as this runtime.",
        settingsTab: "general"
      });

  if (publicTarget && input.searchIndexing && !input.metaDescription?.trim()) {
    checks.push({
      id: "metadata",
      label: "Default search description",
      status: "blocked",
      message: "Add a default meta description before allowing search indexing.",
      settingsTab: "general"
    });
  }

  const emailReady = input.email.configured &&
    input.email.recoveryEnabled &&
    input.email.lastTestSucceeded === true;
  checks.push(emailReady
    ? {
        id: "email",
        label: "Account recovery",
        status: "pass",
        message: "Transactional email was tested and account recovery is enabled."
      }
    : {
        id: "email",
        label: "Account recovery",
        status: publicTarget ? "blocked" : "action",
        message: "Configure and test email, then enable password recovery and invitations.",
        settingsTab: "email"
      });

  const offsiteProtected = input.backup.details?.offsiteProtected === true;
  checks.push(input.backup.status === "pass" && offsiteProtected
    ? {
        id: "backup",
        label: "Disaster recovery",
        status: "pass",
        message: "A recent encrypted backup is verified on protected off-site storage."
      }
    : {
        id: "backup",
        label: "Disaster recovery",
        status: publicTarget ? "blocked" : "action",
        message: input.backup.message || "Complete an encrypted backup and protect its mirror off-site.",
        settingsTab: "updates"
      });

  checks.push(input.ownerMfaEnabled
    ? {
        id: "owner-mfa",
        label: "Owner account protection",
        status: "pass",
        message: "The owner account has two-step verification enabled."
      }
    : {
        id: "owner-mfa",
        label: "Owner account protection",
        status: publicTarget ? "blocked" : "action",
        message: "Enable two-step verification on the owner account before publishing.",
        settingsTab: "security"
      });

  checks.push(input.storageDriver !== "disabled"
    ? {
        id: "storage",
        label: "Persistent media",
        status: "pass",
        message: input.storageDriver === "s3"
          ? "Media uses object storage."
          : "Media uses the persistent self-host volume."
      }
    : {
        id: "storage",
        label: "Persistent media",
        status: "blocked",
        message: "Enable persistent media storage before publishing.",
        settingsTab: "general"
      });

  checks.push(input.updatesEnabled
    ? {
        id: "updates",
        label: "Security updates",
        status: "pass",
        message: "Signed stable update checks are enabled."
      }
    : {
        id: "updates",
        label: "Security updates",
        status: publicTarget ? "blocked" : "action",
        message: "Enable signed stable update checks before publishing.",
        settingsTab: "updates"
      });

  const blocked = checks.filter((check) => check.status === "blocked").length;
  const actions = checks.filter((check) => check.status === "action").length;

  return {
    status: blocked > 0 ? "blocked" as const : actions > 0 ? "attention" as const : "ready" as const,
    target: publicTarget ? "public" as const : "local" as const,
    summary: {
      passed: checks.length - blocked - actions,
      actions,
      blocked,
      total: checks.length
    },
    checks
  };
}
