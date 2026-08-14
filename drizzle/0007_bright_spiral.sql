CREATE TABLE `system_settings` (
	`key` varchar(80) NOT NULL,
	`encrypted_value` text NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `system_settings_key` PRIMARY KEY(`key`)
);
