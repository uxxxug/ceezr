/**
 * الغرض: بنيةٌ تحتيّةٌ لامتثال PDPL — مخزنُ PostgREST لأنشطةِ المعالجةِ
 *   وطلباتِ أصحابِ البياناتِ وتقييماتِ الأثرِ والنقلِ خارجَ المملكةِ (F12-10).
 * الحالة: منفَّذٌ — البندُ F12-10.
 * ينتمي إلى: packages/infrastructure/privacy
 * الحاكم: المادتان ٤ و١٠ و١٣ و١٨ و٢٢ و٢٩ و٣١ من PDPL
 */

import type { PdplComplianceStore, StoreError } from "../../application/privacy/pdpl-compliance.ts";
import type { ProcessingActivity } from "../../domain/privacy/pdpl-compliance.ts";
import type { Result } from "../../shared/result/index.ts";

type PostgrestClient = {
  from(table: string): {
    select(columns?: string): {
      eq(
        column: string,
        value: unknown,
      ): {
        single(): Promise<{ data: unknown | null; error: { message: string } | null }>;
      };
      eq(
        column: string,
        value: unknown,
      ): Promise<{ data: unknown[]; error: { message: string } | null }>;
    };
    insert(values: Record<string, unknown>): {
      select(columns?: string): {
        single(): Promise<{ data: unknown | null; error: { message: string } | null }>;
      };
    };
  };
  rpc(
    functionName: string,
    params?: Record<string, unknown>,
  ): Promise<{
    data: unknown | null;
    error: { message: string } | null;
  }>;
};

function ok<T>(value: T): Result<T, StoreError> {
  return { ok: true, value };
}

function err(reason: StoreError["reason"]): Result<never, StoreError> {
  return { ok: false, error: { reason } };
}

export function createPostgrestPdplStore(client: PostgrestClient): PdplComplianceStore {
  return {
    async getProcessingActivity(
      id: string,
    ): Promise<Result<ProcessingActivity | null, StoreError>> {
      const { data, error } = await client
        .from("pdpl_processing_activities")
        .select("*")
        .eq("id", id)
        .single();
      if (error) return err("STORE_ERROR");
      return ok(data as ProcessingActivity | null);
    },

    async isActivityAllowed(activityId: string): Promise<Result<boolean, StoreError>> {
      const { data, error } = await client.rpc("pdpl_processing_activity_is_allowed", {
        p_activity_id: activityId,
      });
      if (error) return err("STORE_ERROR");
      return ok(Boolean(data));
    },

    async dpiaRequired(activityId: string): Promise<Result<boolean, StoreError>> {
      const { data, error } = await client.rpc("pdpl_dpia_required", {
        p_activity_id: activityId,
      });
      if (error) return err("STORE_ERROR");
      return ok(Boolean(data));
    },

    async dpiaIsApproved(activityId: string): Promise<Result<boolean, StoreError>> {
      const { data, error } = await client.rpc("pdpl_dpia_is_approved", {
        p_activity_id: activityId,
      });
      if (error) return err("STORE_ERROR");
      return ok(Boolean(data));
    },

    async highRiskRequiresDpia(activityId: string): Promise<Result<boolean, StoreError>> {
      const { data, error } = await client.rpc("pdpl_high_risk_requires_dpia", {
        p_activity_id: activityId,
      });
      if (error) return err("STORE_ERROR");
      return ok(Boolean(data));
    },

    async isCrossBorderTransferAllowed(transferId: string): Promise<Result<boolean, StoreError>> {
      const { data, error } = await client.rpc("pdpl_cross_border_transfer_allowed", {
        p_transfer_id: transferId,
      });
      if (error) return err("STORE_ERROR");
      return ok(Boolean(data));
    },

    async isCrossBorderTransferExpired(transferId: string): Promise<Result<boolean, StoreError>> {
      const { data, error } = await client.rpc("pdpl_cross_border_transfer_is_expired", {
        p_transfer_id: transferId,
      });
      if (error) return err("STORE_ERROR");
      return ok(Boolean(data));
    },

    async recordRightRequest(input: {
      cityId: string;
      rightType: string;
      requesterTelegramId: string;
      createdBy: string;
    }): Promise<Result<string, StoreError>> {
      const { data, error } = await client.rpc("pdpl_record_right_request", {
        p_city_id: input.cityId,
        p_right_type: input.rightType,
        p_requester_telegram_id: input.requesterTelegramId,
        p_created_by: input.createdBy,
      });
      if (error) return err("STORE_ERROR");
      if (!data) return err("MALFORMED_RESULT");
      return ok(String(data));
    },

    async closeRightRequest(input: {
      requestId: string;
      status: string;
      resultSummary: string;
      refusalReason?: string | null;
    }): Promise<Result<void, StoreError>> {
      const { error } = await client.rpc("pdpl_close_right_request", {
        p_request_id: input.requestId,
        p_status: input.status,
        p_result_summary: input.resultSummary,
        p_refusal_reason: input.refusalReason ?? null,
      });
      if (error) return err("STORE_ERROR");
      return ok(undefined);
    },

    async isRightRequestOverdue(requestId: string): Promise<Result<boolean, StoreError>> {
      const { data, error } = await client.rpc("pdpl_right_request_is_overdue", {
        p_request_id: requestId,
      });
      if (error) return err("STORE_ERROR");
      return ok(Boolean(data));
    },
  };
}
