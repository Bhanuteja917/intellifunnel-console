-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('active', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "PayoutTrigger" AS ENUM ('monthlyArrears', 'campaignClose');

-- CreateEnum
CREATE TYPE "Portal" AS ENUM ('admin', 'client', 'partner');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('invited', 'active', 'suspended');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "MetricMode" AS ENUM ('event', 'aggregate');

-- CreateEnum
CREATE TYPE "PricingUnit" AS ENUM ('CPL', 'CPM', 'CPA', 'flat');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('single', 'multi', 'text', 'boolean', 'date');

-- CreateEnum
CREATE TYPE "RejectReasonCategory" AS ENUM ('dataQuality', 'icpMismatch', 'suppression', 'duplicate', 'consent', 'qualification', 'contactability');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'pending', 'scheduled', 'live', 'paused', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "IcpDimension" AS ENUM ('industry', 'employeeRange', 'revenueRange', 'country', 'region', 'jobFunction', 'seniority', 'jobTitle', 'custom');

-- CreateEnum
CREATE TYPE "IcpOperator" AS ENUM ('in', 'notIn', 'between', 'contains');

-- CreateEnum
CREATE TYPE "LeadFieldDataType" AS ENUM ('string', 'number', 'boolean', 'date', 'email', 'phone', 'url');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('internal', 'client');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('approved', 'rejected');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('draft', 'active', 'paused', 'ended');

-- CreateEnum
CREATE TYPE "CampaignChannelStatus" AS ENUM ('draft', 'pending', 'scheduled', 'live', 'paused', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('targetAccounts', 'suppression', 'leads', 'metrics');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "ListType" AS ENUM ('targetAccounts', 'suppression');

-- CreateEnum
CREATE TYPE "LeadSourceType" AS ENUM ('internal', 'partner', 'form');

-- CreateEnum
CREATE TYPE "LeadVerificationStatus" AS ENUM ('pending', 'autoValidating', 'failed', 'needsReview', 'passed');

-- CreateEnum
CREATE TYPE "LeadLifecycleStatus" AS ENUM ('new', 'accepted', 'rejected', 'delivered');

-- CreateEnum
CREATE TYPE "LeadEnrichmentStatus" AS ENUM ('notRequired', 'pending', 'inProgress', 'complete');

-- CreateEnum
CREATE TYPE "LeadStatusDimension" AS ENUM ('verification', 'lifecycle', 'enrichment');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('webhook', 'csv');

-- CreateEnum
CREATE TYPE "DeliveryConfigStatus" AS ENUM ('active', 'paused');

-- CreateEnum
CREATE TYPE "DeliveryRunStatus" AS ENUM ('pending', 'success', 'failed', 'exhausted');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('auto', 'manual', 'tele');

-- CreateEnum
CREATE TYPE "VerificationOutcome" AS ENUM ('pass', 'fail', 'needsReview');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('whitepaper', 'ebook', 'researchPaper', 'creative', 'webinar', 'other');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "AssetPlacementStatus" AS ENUM ('draft', 'active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "ChannelSetupStepKey" AS ENUM ('channelTerms', 'icp', 'leadSpec', 'placement', 'allocations', 'targetAccountList', 'suppressionList');

-- CreateEnum
CREATE TYPE "ChannelSetupRequirement" AS ENUM ('required', 'optional');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "isClient" BOOLEAN NOT NULL DEFAULT false,
    "isPartner" BOOLEAN NOT NULL DEFAULT false,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'active',
    "country" TEXT,
    "defaultBillingCurrency" CHAR(3),
    "defaultPayoutCurrency" CHAR(3),
    "payoutTrigger" "PayoutTrigger" NOT NULL DEFAULT 'monthlyArrears',
    "personalDataRetentionMonths" INTEGER,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'invited',
    "lastLoginAt" TIMESTAMP(3),
    "authUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "portal" "Portal" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedById" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorOrganizationId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authUser" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authSession" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "authSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authAccount" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL DEFAULT 'local:credential',
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authVerification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "primaryDomain" TEXT,
    "parentAccountId" TEXT,
    "country" TEXT,
    "industry" TEXT,
    "employeeRange" TEXT,
    "revenueRange" TEXT,
    "enrichmentSource" TEXT,
    "enrichedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "jobTitle" TEXT,
    "seniority" TEXT,
    "jobFunction" TEXT,
    "phone" TEXT,
    "country" TEXT,
    "linkedinUrl" TEXT,
    "anonymisedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelStage" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunnelStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "funnelStageId" TEXT NOT NULL,
    "producesLeads" BOOLEAN NOT NULL DEFAULT true,
    "requiresAsset" BOOLEAN NOT NULL DEFAULT false,
    "metricMode" "MetricMode" NOT NULL DEFAULT 'event',
    "allowedMetricFieldsJson" JSONB NOT NULL DEFAULT '[]',
    "pricingUnit" "PricingUnit" NOT NULL,
    "defaultQualificationFormId" TEXT,
    "verificationRuleSetId" TEXT,
    "requiresTeleVerification" BOOLEAN NOT NULL DEFAULT false,
    "verificationSlaBusinessDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "ChannelType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelTypeVersion" (
    "id" TEXT NOT NULL,
    "channelTypeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definitionJson" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelTypeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualificationForm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualificationForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualificationQuestion" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "optionsJson" JSONB,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isQualifying" BOOLEAN NOT NULL DEFAULT false,
    "acceptableAnswersJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualificationQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RejectReason" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" "RejectReasonCategory" NOT NULL,
    "isPartnerReplaceable" BOOLEAN NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RejectReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "clientOrganizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "clonedFromCampaignId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IcpCriterion" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "dimension" "IcpDimension" NOT NULL,
    "operator" "IcpOperator" NOT NULL,
    "valuesJson" JSONB NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "IcpCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadFieldSpec" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "dataType" "LeadFieldDataType" NOT NULL,
    "allowedValuesJson" JSONB,
    "validationPattern" TEXT,
    "rejectIfMissing" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "LeadFieldSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignChannel" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "channelTypeVersionId" TEXT NOT NULL,
    "contractedQuantity" INTEGER NOT NULL,
    "clientUnitPriceMinor" BIGINT NOT NULL,
    "costBudgetMinor" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "CampaignChannelStatus" NOT NULL DEFAULT 'draft',
    "advisoryIcpMatch" BOOLEAN NOT NULL DEFAULT false,
    "advisoryTalMatch" BOOLEAN NOT NULL DEFAULT false,
    "defaultMaxLeadsPerAccount" INTEGER,
    "qualificationFormId" TEXT,
    "reservedCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "CampaignChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerAllocation" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "partnerOrganizationId" TEXT NOT NULL,
    "allocatedQuantity" INTEGER NOT NULL,
    "payoutRateMinor" BIGINT NOT NULL,
    "payoutCurrency" CHAR(3) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'draft',
    "revealClientIdentity" BOOLEAN NOT NULL DEFAULT false,
    "reservedCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "PartnerAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelApproval" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "type" "ApprovalType" NOT NULL DEFAULT 'client',
    "decision" "ApprovalDecision" NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comments" TEXT,
    "termsSnapshotJson" JSONB NOT NULL,
    "icpSnapshotJson" JSONB,
    "leadSpecSnapshotJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "ChannelApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelTermsApproval" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comments" TEXT,
    "termsSnapshotJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "ChannelTermsApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementApproval" (
    "id" TEXT NOT NULL,
    "assetPlacementId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comments" TEXT,
    "placementSnapshotJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "PlacementApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignStatusHistory" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "fromStatus" "CampaignStatus",
    "toStatus" "CampaignStatus" NOT NULL,
    "changedByUserId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "CampaignStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "type" "ImportType" NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fileKey" TEXT,
    "mappingJson" JSONB NOT NULL,
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsAccepted" INTEGER NOT NULL DEFAULT 0,
    "rowsFailed" INTEGER NOT NULL DEFAULT 0,
    "status" "ImportStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportError" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "field" TEXT,
    "rawValue" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "List" (
    "id" TEXT NOT NULL,
    "ownerOrganizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isReusable" BOOLEAN NOT NULL DEFAULT true,
    "type" "ListType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "List_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListEntry" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "accountName" TEXT,
    "accountRawDomain" TEXT,
    "accountNormalizedDomain" TEXT,
    "maxLeadsPerAccountOverride" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "ListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelList" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "ChannelList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSubmission" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "sourceType" "LeadSourceType" NOT NULL,
    "submittedById" TEXT NOT NULL,
    "partnerOrganizationId" TEXT,
    "fileKey" TEXT,
    "mappingJson" JSONB NOT NULL,
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsAccepted" INTEGER NOT NULL DEFAULT 0,
    "rowsFailed" INTEGER NOT NULL DEFAULT 0,
    "status" "ImportStatus" NOT NULL DEFAULT 'pending',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSubmissionError" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "field" TEXT,
    "rawValue" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSubmissionError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sourceType" "LeadSourceType" NOT NULL,
    "verificationStatus" "LeadVerificationStatus" NOT NULL DEFAULT 'pending',
    "lifecycleStatus" "LeadLifecycleStatus" NOT NULL DEFAULT 'new',
    "enrichmentStatus" "LeadEnrichmentStatus" NOT NULL DEFAULT 'notRequired',
    "clientVisible" BOOLEAN NOT NULL DEFAULT false,
    "rejectReasonId" TEXT,
    "fieldValuesJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "assignedToUserId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "verificationElapsedMinutes" INTEGER,
    "verificationElapsedBusinessMinutes" INTEGER,
    "slaBreached" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadStatusHistory" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "dimension" "LeadStatusDimension" NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "LeadStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadConsent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "consentTextVersionId" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryConfig" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "method" "DeliveryMethod" NOT NULL,
    "status" "DeliveryConfigStatus" NOT NULL DEFAULT 'active',
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "csvScheduleCron" TEXT,
    "fieldMappingJson" JSONB NOT NULL,
    "lastCsvCursorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "DeliveryConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRun" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "method" "DeliveryMethod" NOT NULL,
    "status" "DeliveryRunStatus" NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "fileUrl" TEXT,
    "requestPayloadJson" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRunLead" (
    "deliveryRunId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,

    CONSTRAINT "DeliveryRunLead_pkey" PRIMARY KEY ("deliveryRunId","leadId")
);

-- CreateTable
CREATE TABLE "VerificationRecord" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "method" "VerificationMethod" NOT NULL,
    "ruleResultsJson" JSONB,
    "outcome" "VerificationOutcome" NOT NULL,
    "verifiedByUserId" TEXT,
    "callSystem" TEXT,
    "callReferenceId" TEXT,
    "callOccurredAt" TIMESTAMP(3),
    "callDurationSeconds" INTEGER,
    "callRecordingKey" TEXT,
    "notes" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "ownerOrganizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "language" TEXT NOT NULL,
    "currentVersionId" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetVersion" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentTextVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "language" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ConsentTextVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetPlacement" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "landingPageUrl" TEXT NOT NULL,
    "formSlug" TEXT NOT NULL,
    "consentTextVersionId" TEXT,
    "status" "AssetPlacementStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "AssetPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementEvent" (
    "id" TEXT NOT NULL,
    "assetPlacementId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelPacingBucket" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "targetQuantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "ChannelPacingBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelSetupStep" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "stepKey" "ChannelSetupStepKey" NOT NULL,
    "requirement" "ChannelSetupRequirement" NOT NULL DEFAULT 'required',
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "ChannelSetupStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Organization_isClient_idx" ON "Organization"("isClient");

-- CreateIndex
CREATE INDEX "Organization_isPartner_idx" ON "Organization"("isPartner");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_email_status_idx" ON "Invitation"("email", "status");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_idx" ON "Invitation"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_occurredAt_idx" ON "AuditLog"("entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_occurredAt_idx" ON "AuditLog"("actorUserId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "authUser_email_key" ON "authUser"("email");

-- CreateIndex
CREATE INDEX "authSession_userId_idx" ON "authSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "authSession_token_key" ON "authSession"("token");

-- CreateIndex
CREATE INDEX "authAccount_userId_idx" ON "authAccount"("userId");

-- CreateIndex
CREATE INDEX "authAccount_issuer_accountId_idx" ON "authAccount"("issuer", "accountId");

-- CreateIndex
CREATE INDEX "authVerification_identifier_idx" ON "authVerification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Account_primaryDomain_key" ON "Account"("primaryDomain");

-- CreateIndex
CREATE INDEX "Account_normalizedName_country_idx" ON "Account"("normalizedName", "country");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_emailNormalized_key" ON "Contact"("emailNormalized");

-- CreateIndex
CREATE INDEX "Contact_accountId_idx" ON "Contact"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "FunnelStage_code_key" ON "FunnelStage"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelType_code_key" ON "ChannelType"("code");

-- CreateIndex
CREATE INDEX "ChannelType_funnelStageId_idx" ON "ChannelType"("funnelStageId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelTypeVersion_channelTypeId_version_key" ON "ChannelTypeVersion"("channelTypeId", "version");

-- CreateIndex
CREATE INDEX "QualificationQuestion_formId_idx" ON "QualificationQuestion"("formId");

-- CreateIndex
CREATE UNIQUE INDEX "QualificationQuestion_formId_sortOrder_key" ON "QualificationQuestion"("formId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "RejectReason_code_key" ON "RejectReason"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_code_key" ON "Campaign"("code");

-- CreateIndex
CREATE INDEX "Campaign_clientOrganizationId_status_idx" ON "Campaign"("clientOrganizationId", "status");

-- CreateIndex
CREATE INDEX "Campaign_status_startDate_idx" ON "Campaign"("status", "startDate");

-- CreateIndex
CREATE INDEX "IcpCriterion_campaignChannelId_idx" ON "IcpCriterion"("campaignChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadFieldSpec_campaignChannelId_fieldKey_key" ON "LeadFieldSpec"("campaignChannelId", "fieldKey");

-- CreateIndex
CREATE INDEX "CampaignChannel_campaignId_idx" ON "CampaignChannel"("campaignId");

-- CreateIndex
CREATE INDEX "PartnerAllocation_campaignChannelId_idx" ON "PartnerAllocation"("campaignChannelId");

-- CreateIndex
CREATE INDEX "PartnerAllocation_partnerOrganizationId_idx" ON "PartnerAllocation"("partnerOrganizationId");

-- CreateIndex
CREATE INDEX "ChannelApproval_campaignChannelId_type_decidedAt_idx" ON "ChannelApproval"("campaignChannelId", "type", "decidedAt");

-- CreateIndex
CREATE INDEX "ChannelTermsApproval_campaignChannelId_decidedAt_idx" ON "ChannelTermsApproval"("campaignChannelId", "decidedAt");

-- CreateIndex
CREATE INDEX "PlacementApproval_assetPlacementId_decidedAt_idx" ON "PlacementApproval"("assetPlacementId", "decidedAt");

-- CreateIndex
CREATE INDEX "CampaignStatusHistory_campaignId_changedAt_idx" ON "CampaignStatusHistory"("campaignId", "changedAt");

-- CreateIndex
CREATE INDEX "ImportBatch_organizationId_type_createdAt_idx" ON "ImportBatch"("organizationId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "ImportError_batchId_rowNumber_idx" ON "ImportError"("batchId", "rowNumber");

-- CreateIndex
CREATE INDEX "List_ownerOrganizationId_idx" ON "List"("ownerOrganizationId");

-- CreateIndex
CREATE INDEX "ListEntry_listId_idx" ON "ListEntry"("listId");

-- CreateIndex
CREATE INDEX "ListEntry_accountNormalizedDomain_idx" ON "ListEntry"("accountNormalizedDomain");

-- CreateIndex
CREATE INDEX "ChannelList_campaignChannelId_idx" ON "ChannelList"("campaignChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelList_campaignChannelId_listId_key" ON "ChannelList"("campaignChannelId", "listId");

-- CreateIndex
CREATE INDEX "LeadSubmission_campaignChannelId_status_idx" ON "LeadSubmission"("campaignChannelId", "status");

-- CreateIndex
CREATE INDEX "LeadSubmission_partnerOrganizationId_idx" ON "LeadSubmission"("partnerOrganizationId");

-- CreateIndex
CREATE INDEX "LeadSubmissionError_submissionId_rowNumber_idx" ON "LeadSubmissionError"("submissionId", "rowNumber");

-- CreateIndex
CREATE INDEX "Lead_campaignChannelId_verificationStatus_idx" ON "Lead"("campaignChannelId", "verificationStatus");

-- CreateIndex
CREATE INDEX "Lead_accountId_idx" ON "Lead"("accountId");

-- CreateIndex
CREATE INDEX "Lead_contactId_idx" ON "Lead"("contactId");

-- CreateIndex
CREATE INDEX "LeadStatusHistory_leadId_dimension_idx" ON "LeadStatusHistory"("leadId", "dimension");

-- CreateIndex
CREATE UNIQUE INDEX "LeadConsent_leadId_key" ON "LeadConsent"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryConfig_campaignChannelId_key" ON "DeliveryConfig"("campaignChannelId");

-- CreateIndex
CREATE INDEX "DeliveryRun_campaignChannelId_idx" ON "DeliveryRun"("campaignChannelId");

-- CreateIndex
CREATE INDEX "DeliveryRun_status_nextRetryAt_idx" ON "DeliveryRun"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "DeliveryRunLead_leadId_idx" ON "DeliveryRunLead"("leadId");

-- CreateIndex
CREATE INDEX "VerificationRecord_leadId_idx" ON "VerificationRecord"("leadId");

-- CreateIndex
CREATE INDEX "Asset_ownerOrganizationId_idx" ON "Asset"("ownerOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_assetId_version_key" ON "AssetVersion"("assetId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentTextVersion_name_version_key" ON "ConsentTextVersion"("name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AssetPlacement_formSlug_key" ON "AssetPlacement"("formSlug");

-- CreateIndex
CREATE INDEX "AssetPlacement_campaignChannelId_idx" ON "AssetPlacement"("campaignChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementEvent_assetPlacementId_date_key" ON "EngagementEvent"("assetPlacementId", "date");

-- CreateIndex
CREATE INDEX "ChannelPacingBucket_campaignChannelId_idx" ON "ChannelPacingBucket"("campaignChannelId");

-- CreateIndex
CREATE INDEX "ChannelSetupStep_campaignChannelId_idx" ON "ChannelSetupStep"("campaignChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelSetupStep_campaignChannelId_stepKey_key" ON "ChannelSetupStep"("campaignChannelId", "stepKey");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authSession" ADD CONSTRAINT "authSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "authUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authAccount" ADD CONSTRAINT "authAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "authUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelType" ADD CONSTRAINT "ChannelType_funnelStageId_fkey" FOREIGN KEY ("funnelStageId") REFERENCES "FunnelStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelType" ADD CONSTRAINT "ChannelType_defaultQualificationFormId_fkey" FOREIGN KEY ("defaultQualificationFormId") REFERENCES "QualificationForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelTypeVersion" ADD CONSTRAINT "ChannelTypeVersion_channelTypeId_fkey" FOREIGN KEY ("channelTypeId") REFERENCES "ChannelType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationQuestion" ADD CONSTRAINT "QualificationQuestion_formId_fkey" FOREIGN KEY ("formId") REFERENCES "QualificationForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_clientOrganizationId_fkey" FOREIGN KEY ("clientOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_clonedFromCampaignId_fkey" FOREIGN KEY ("clonedFromCampaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcpCriterion" ADD CONSTRAINT "IcpCriterion_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadFieldSpec" ADD CONSTRAINT "LeadFieldSpec_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignChannel" ADD CONSTRAINT "CampaignChannel_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignChannel" ADD CONSTRAINT "CampaignChannel_channelTypeVersionId_fkey" FOREIGN KEY ("channelTypeVersionId") REFERENCES "ChannelTypeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignChannel" ADD CONSTRAINT "CampaignChannel_qualificationFormId_fkey" FOREIGN KEY ("qualificationFormId") REFERENCES "QualificationForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerAllocation" ADD CONSTRAINT "PartnerAllocation_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerAllocation" ADD CONSTRAINT "PartnerAllocation_partnerOrganizationId_fkey" FOREIGN KEY ("partnerOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelApproval" ADD CONSTRAINT "ChannelApproval_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelTermsApproval" ADD CONSTRAINT "ChannelTermsApproval_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementApproval" ADD CONSTRAINT "PlacementApproval_assetPlacementId_fkey" FOREIGN KEY ("assetPlacementId") REFERENCES "AssetPlacement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignStatusHistory" ADD CONSTRAINT "CampaignStatusHistory_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportError" ADD CONSTRAINT "ImportError_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListEntry" ADD CONSTRAINT "ListEntry_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelList" ADD CONSTRAINT "ChannelList_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelList" ADD CONSTRAINT "ChannelList_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSubmission" ADD CONSTRAINT "LeadSubmission_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSubmission" ADD CONSTRAINT "LeadSubmission_partnerOrganizationId_fkey" FOREIGN KEY ("partnerOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSubmissionError" ADD CONSTRAINT "LeadSubmissionError_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "LeadSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "LeadSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_rejectReasonId_fkey" FOREIGN KEY ("rejectReasonId") REFERENCES "RejectReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStatusHistory" ADD CONSTRAINT "LeadStatusHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadConsent" ADD CONSTRAINT "LeadConsent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadConsent" ADD CONSTRAINT "LeadConsent_consentTextVersionId_fkey" FOREIGN KEY ("consentTextVersionId") REFERENCES "ConsentTextVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryConfig" ADD CONSTRAINT "DeliveryConfig_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRun" ADD CONSTRAINT "DeliveryRun_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRunLead" ADD CONSTRAINT "DeliveryRunLead_deliveryRunId_fkey" FOREIGN KEY ("deliveryRunId") REFERENCES "DeliveryRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRunLead" ADD CONSTRAINT "DeliveryRunLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRecord" ADD CONSTRAINT "VerificationRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_ownerOrganizationId_fkey" FOREIGN KEY ("ownerOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVersion" ADD CONSTRAINT "AssetVersion_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetPlacement" ADD CONSTRAINT "AssetPlacement_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetPlacement" ADD CONSTRAINT "AssetPlacement_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetPlacement" ADD CONSTRAINT "AssetPlacement_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetPlacement" ADD CONSTRAINT "AssetPlacement_consentTextVersionId_fkey" FOREIGN KEY ("consentTextVersionId") REFERENCES "ConsentTextVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementEvent" ADD CONSTRAINT "EngagementEvent_assetPlacementId_fkey" FOREIGN KEY ("assetPlacementId") REFERENCES "AssetPlacement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementEvent" ADD CONSTRAINT "EngagementEvent_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelPacingBucket" ADD CONSTRAINT "ChannelPacingBucket_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelSetupStep" ADD CONSTRAINT "ChannelSetupStep_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
