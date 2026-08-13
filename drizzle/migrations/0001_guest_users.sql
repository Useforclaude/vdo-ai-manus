CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `open_id` varchar(64) NOT NULL,
  `name` text,
  `email` varchar(320),
  `login_method` varchar(64),
  `role` enum('user','admin') NOT NULL DEFAULT 'user',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_signed_in` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_open_id_unique` (`open_id`)
);
