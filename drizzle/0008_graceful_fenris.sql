CREATE TABLE `system_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`service` enum('mysql','storage','ai') NOT NULL,
	`state` enum('open','resolved') NOT NULL DEFAULT 'open',
	`summary` varchar(240) NOT NULL,
	`detail` varchar(1000) NOT NULL,
	`first_detected_at` timestamp NOT NULL DEFAULT (now()),
	`last_detected_at` timestamp NOT NULL DEFAULT (now()),
	`resolved_at` timestamp,
	CONSTRAINT `system_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `system_health_checks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`service` enum('mysql','storage','ai') NOT NULL,
	`status` enum('healthy','degraded','unconfigured') NOT NULL,
	`detail` varchar(1000) NOT NULL,
	`checked_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `system_health_checks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `system_alerts_service_state_idx` ON `system_alerts` (`service`,`state`,`last_detected_at`);--> statement-breakpoint
CREATE INDEX `system_health_service_checked_idx` ON `system_health_checks` (`service`,`checked_at`);