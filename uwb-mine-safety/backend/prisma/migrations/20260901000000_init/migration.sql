-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'dispatcher', 'viewer');
CREATE TYPE "PersonStatus" AS ENUM ('active', 'stationary', 'offline');
CREATE TYPE "ZoneLevel" AS ENUM ('restricted', 'warning', 'safe');
CREATE TYPE "AlarmType" AS ENUM ('zone_intrusion', 'stationary', 'sos', 'low_battery', 'offline');
CREATE TYPE "AlarmSeverity" AS ENUM ('info', 'warning', 'critical');
CREATE TYPE "AlarmStatus" AS ENUM ('active', 'acked', 'resolved');
CREATE TYPE "BroadcastStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'viewer',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

CREATE TABLE "Person" (
    "tagId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeNo" TEXT,
    "jobTitle" TEXT,
    "team" TEXT,
    "phone" TEXT,
    "photoUrl" TEXT,
    "batteryPct" INTEGER,
    "status" "PersonStatus" NOT NULL DEFAULT 'offline',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "lastPos" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Person_pkey" PRIMARY KEY ("tagId")
);
CREATE UNIQUE INDEX "Person_tagId_key" ON "Person"("tagId");
CREATE UNIQUE INDEX "Person_employeeNo_key" ON "Person"("employeeNo") WHERE "employeeNo" IS NOT NULL;

CREATE TABLE "Anchor" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "zoneId" TEXT,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Anchor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Anchor_code_key" ON "Anchor"("code");

CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "ZoneLevel" NOT NULL DEFAULT 'restricted',
    "polygon" JSONB NOT NULL,
    "floor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "speakerGroup" TEXT,
    "broadcastTpl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Zone_code_key" ON "Zone"("code");

CREATE TABLE "Position" (
    "id" BIGSERIAL NOT NULL,
    "personId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,
    "batteryPct" INTEGER,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Position_personId_measuredAt_idx" ON "Position"("personId", "measuredAt");
CREATE INDEX "Position_measuredAt_idx" ON "Position"("measuredAt");

CREATE TABLE "Alarm" (
    "id" TEXT NOT NULL,
    "type" "AlarmType" NOT NULL,
    "severity" "AlarmSeverity" NOT NULL,
    "status" "AlarmStatus" NOT NULL DEFAULT 'active',
    "personId" TEXT NOT NULL,
    "zoneId" TEXT,
    "dedupKey" TEXT NOT NULL,
    "position" JSONB,
    "message" TEXT NOT NULL,
    "repeatCount" INTEGER NOT NULL DEFAULT 1,
    "lastFiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstFiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackedById" TEXT,
    "ackedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolveNote" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Alarm_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Alarm_dedupKey_status_idx" ON "Alarm"("dedupKey", "status");
CREATE INDEX "Alarm_status_severity_idx" ON "Alarm"("status", "severity");
CREATE INDEX "Alarm_personId_createdAt_idx" ON "Alarm"("personId", "createdAt");

-- 关键：同一个去重键只允许存在一条未解除（active/acked）的告警，
-- 并发入库时由数据库兜底，避免"先查后插"产生重复告警。
CREATE UNIQUE INDEX "alarm_open_dedup_uniq"
    ON "Alarm"("dedupKey")
    WHERE "status" IN ('active', 'acked');

CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "alarmId" TEXT,
    "triggerType" TEXT NOT NULL DEFAULT 'auto',
    "targetGroup" TEXT,
    "content" TEXT NOT NULL,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Broadcast_alarmId_idx" ON "Broadcast"("alarmId");

CREATE TABLE "IngestKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IngestKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IngestKey_key_idx" ON "IngestKey"("key");

-- AddForeignKey
ALTER TABLE "Anchor" ADD CONSTRAINT "Anchor_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Position" ADD CONSTRAINT "Position_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("tagId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Alarm" ADD CONSTRAINT "Alarm_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("tagId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Alarm" ADD CONSTRAINT "Alarm_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Alarm" ADD CONSTRAINT "Alarm_ackedById_fkey" FOREIGN KEY ("ackedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_alarmId_fkey" FOREIGN KEY ("alarmId") REFERENCES "Alarm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
