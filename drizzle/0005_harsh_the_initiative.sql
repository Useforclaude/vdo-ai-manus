CREATE TABLE `mcp_access_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`project_id` int NOT NULL,
	`label` varchar(80) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`scope` enum('read','edit','render') NOT NULL DEFAULT 'read',
	`expires_at` timestamp NOT NULL,
	`last_used_at` timestamp,
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mcp_access_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `mcp_access_tokens_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE INDEX `mcp_tokens_user_project_idx` ON `mcp_access_tokens` (`user_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `mcp_tokens_active_idx` ON `mcp_access_tokens` (`token_hash`,`expires_at`);