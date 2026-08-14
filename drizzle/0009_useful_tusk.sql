CREATE TABLE `video_upload_parts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`session_id` varchar(64) NOT NULL,
	`part_index` int NOT NULL,
	`storage_key` varchar(1024) NOT NULL,
	`size_bytes` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `video_upload_parts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `video_upload_sessions` (
	`id` varchar(64) NOT NULL,
	`user_id` int NOT NULL,
	`project_id` int,
	`file_name` varchar(512) NOT NULL,
	`mime_type` varchar(255) NOT NULL,
	`total_bytes` int NOT NULL,
	`total_parts` int NOT NULL,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `video_upload_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `upload_parts_session_index_idx` ON `video_upload_parts` (`session_id`,`part_index`);--> statement-breakpoint
CREATE INDEX `upload_sessions_user_expires_idx` ON `video_upload_sessions` (`user_id`,`expires_at`);