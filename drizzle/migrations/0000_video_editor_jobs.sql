CREATE TABLE `video_projects` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `title` varchar(255) NOT NULL,
  `sourceFileName` varchar(255) NOT NULL,
  `sourceStorageKey` varchar(512) NOT NULL,
  `sourceUrl` text NOT NULL,
  `sourceMimeType` varchar(128) NOT NULL,
  `sourceBytes` int NOT NULL,
  `durationSeconds` int,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `video_projects_id` PRIMARY KEY(`id`),
  CONSTRAINT `video_projects_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade
);

CREATE TABLE `edit_jobs` (
  `id` varchar(64) NOT NULL,
  `projectId` int NOT NULL,
  `userId` int NOT NULL,
  `command` text NOT NULL,
  `commandLanguage` enum('th','en','mixed','unknown') NOT NULL DEFAULT 'unknown',
  `operationPlan` json NOT NULL,
  `status` enum('queued','processing','complete','failed') NOT NULL DEFAULT 'queued',
  `progress` int NOT NULL DEFAULT 0,
  `processedStorageKey` varchar(512),
  `processedUrl` text,
  `subtitleStorageKey` varchar(512),
  `subtitleUrl` text,
  `errorMessage` text,
  `startedAt` timestamp,
  `completedAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `edit_jobs_id` PRIMARY KEY(`id`),
  CONSTRAINT `edit_jobs_projectId_video_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `video_projects`(`id`) ON DELETE cascade,
  CONSTRAINT `edit_jobs_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade
);
