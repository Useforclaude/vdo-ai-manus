CREATE TABLE `mcp_audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`project_id` int NOT NULL,
	`token_id` int NOT NULL,
	`tool_name` varchar(96) NOT NULL,
	`status` enum('succeeded','rejected','failed') NOT NULL,
	`request_summary` varchar(1000) NOT NULL,
	`result_summary` varchar(1000) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mcp_audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `mcp_audit_project_created_idx` ON `mcp_audit_logs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `mcp_audit_token_created_idx` ON `mcp_audit_logs` (`token_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `mcp_audit_user_project_idx` ON `mcp_audit_logs` (`user_id`,`project_id`);