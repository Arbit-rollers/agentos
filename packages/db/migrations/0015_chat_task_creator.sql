-- Chat tasks created before v0.4.3 did not record who started them: take it from the
-- conversation, so approvals and cancellation go to the right person.
UPDATE "tasks" AS t
SET "created_by" = c."user_id"
FROM "runs" AS r
JOIN "conversations" AS c ON c."id" = r."conversation_id"
WHERE r."task_id" = t."id" AND t."origin" = 'chat' AND t."created_by" IS NULL;
