CREATE TABLE `users` (
  `id` int AUTO_INCREMENT NOT NULL,
  `open_id` varchar(64) NOT NULL,
  `name` text,
  `email` varchar(320),
  `login_method` varchar(64),
  `role` enum('user','admin') NOT NULL DEFAULT 'user',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_signed_in` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `users_id` PRIMARY KEY (`id`),
  CONSTRAINT `users_open_id_unique` UNIQUE (`open_id`)
);
--> statement-breakpoint
CREATE TABLE `video_projects` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `title` varchar(255) NOT NULL,
  `source_file_name` varchar(512) NOT NULL,
  `source_storage_key` varchar(1024) NOT NULL,
  `source_url` text NOT NULL,
  `source_mime_type` varchar(255) NOT NULL,
  `source_bytes` int NOT NULL,
  `duration_seconds` int,
  `expires_at` timestamp,
  `deleted_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `video_projects_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE TABLE `video_clips` (
  `id` int AUTO_INCREMENT NOT NULL,
  `project_id` int NOT NULL,
  `user_id` int NOT NULL,
  `sort_order` int NOT NULL,
  `original_name` varchar(512) NOT NULL,
  `mime_type` varchar(255) NOT NULL,
  `size_bytes` int NOT NULL,
  `storage_key` varchar(1024) NOT NULL,
  `storage_url` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `video_clips_id` PRIMARY KEY (`id`),
  KEY `video_clips_project_order_idx` (`project_id`, `sort_order`),
  KEY `video_clips_user_project_idx` (`user_id`, `project_id`)
);
--> statement-breakpoint
CREATE TABLE `edit_jobs` (
  `id` varchar(64) NOT NULL,
  `project_id` int NOT NULL,
  `user_id` int NOT NULL,
  `command` text NOT NULL,
  `command_language` varchar(16) NOT NULL DEFAULT 'unknown',
  `operation_plan` json NOT NULL,
  `status` enum('queued','processing','complete','failed') NOT NULL DEFAULT 'queued',
  `progress` int NOT NULL DEFAULT 0,
  `processed_storage_key` varchar(1024),
  `processed_url` text,
  `subtitle_storage_key` varchar(1024),
  `subtitle_url` text,
  `subtitle_font` varchar(120) NOT NULL DEFAULT 'Noto Sans Thai',
  `subtitle_size` varchar(16) NOT NULL DEFAULT 'medium',
  `subtitle_position` varchar(16) NOT NULL DEFAULT 'bottom',
  `error_message` text,
  `started_at` timestamp,
  `completed_at` timestamp,
  `deleted_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `edit_jobs_id` PRIMARY KEY (`id`)
);
