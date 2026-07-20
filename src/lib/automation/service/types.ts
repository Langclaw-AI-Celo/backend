import type {
  AccountAuthInput,
  AuthenticatedAccount,
} from "../../server/account-auth";
import type { Database, Json } from "../../supabase/database.types";
import type { ResearchReport, ZeroGProof } from "../../langclaw/types";
import type { OnChainToolFinalPayload } from "../../onchain-tools/types";
import type { UsageReservation } from "../../usage";
import type {
  AutomationDashboard,
  AutomationFrequency,
  AutomationInAppNotification,
  AutomationRun,
  AutomationRunStatus,
  AutomationSettings,
  AutomationSettingsInput,
  AutomationStats,
  AutomationTask,
  AutomationTaskInput,
  AutomationTaskStatus,
  AutomationTriggeredBy,
  AutomationTriggerType,
} from "../types";

export type {
  AccountAuthInput,
  AutomationDashboard,
  AutomationFrequency,
  AutomationInAppNotification,
  AutomationRun,
  AutomationRunStatus,
  AutomationSettings,
  AutomationSettingsInput,
  AutomationStats,
  AutomationTask,
  AutomationTaskInput,
  AutomationTaskStatus,
  AutomationTriggeredBy,
  AutomationTriggerType,
  AuthenticatedAccount,
  Database,
  Json,
  OnChainToolFinalPayload,
  ResearchReport,
  UsageReservation,
  ZeroGProof,
};

export type AutomationSettingsRow =
  Database["public"]["Tables"]["langclaw_automation_settings"]["Row"];
export type AutomationTaskRow =
  Database["public"]["Tables"]["langclaw_automation_tasks"]["Row"];
export type AutomationRunRow =
  Database["public"]["Tables"]["langclaw_automation_runs"]["Row"];
export type AutomationNotificationRow =
  Database["public"]["Tables"]["langclaw_automation_notifications"]["Row"];
export type AutomationContext = AuthenticatedAccount;

export type GuardrailDecision =
  | {
      allowed: true;
      note?: string;
    }
  | {
      allowed: false;
      pauseTask: boolean;
      reason: string;
    };

export type TelegramLinkCandidate = {
  chatId: string;
  code: string;
  username?: string;
};
