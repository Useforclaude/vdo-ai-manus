ALTER TABLE `edit_jobs` ADD `subtitle_preset` enum('thai_standard','thai_story','thai_minimal','custom') DEFAULT 'thai_standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `video_clips` ADD `trim_start_ms` int;--> statement-breakpoint
ALTER TABLE `video_clips` ADD `trim_end_ms` int;