CREATE TABLE `subtitle_presets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`name` varchar(80) NOT NULL,
	`font` varchar(120) NOT NULL DEFAULT 'Noto Sans Thai',
	`size` enum('small','medium','large') NOT NULL DEFAULT 'medium',
	`position` enum('bottom','middle','top') NOT NULL DEFAULT 'bottom',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subtitle_presets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `subtitle_presets_user_updated_idx` ON `subtitle_presets` (`user_id`,`updated_at`);