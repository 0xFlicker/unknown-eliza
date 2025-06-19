import {
  logger,
  Service,
  stringToUuid,
  type Entity,
  type IAgentRuntime,
  type Metadata,
  type Relationship,
  type UUID
} from '@elizaos/core';

// Import our local calculateRelationshipStrength function since it's not exported from core yet
import { calculateRelationshipStrength } from '../utils/relationshipStrength';

// Extended Relationship interface with new fields (until core is updated)
interface ExtendedRelationship extends Relationship {
  relationshipType?: string;
  strength?: number;
  lastInteractionAt?: string;
  nextFollowUpAt?: string;
}

export interface ContactCategory {
  id: string;
  name: string;
  description?: string;
  color?: string;
}

export interface ContactPreferences {
  preferredCommunicationChannel?: string;
  timezone?: string;
  language?: string;
  contactFrequency?: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  doNotDisturb?: boolean;
  notes?: string;
}

export interface ContactInfo {
  entityId: UUID;
  categories: string[];
  tags: string[];
  preferences: ContactPreferences;
  customFields: Record<string, any>;
  privacyLevel: 'public' | 'private' | 'restricted';
  lastModified: string;
}

export interface RelationshipAnalytics {
  strength: number;
  interactionCount: number;
  lastInteractionAt?: string;
  averageResponseTime?: number;
  sentimentScore?: number;
  topicsDiscussed: string[];
}

export interface FollowUpSchedule {
  entityId: UUID;
  scheduledAt: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  completed: boolean;
  taskId?: UUID;
}

// Entity lifecycle event types (local until exported from core)
export enum EntityLifecycleEvent {
  CREATED = 'entity:created',
  UPDATED = 'entity:updated',
  MERGED = 'entity:merged',
  RESOLVED = 'entity:resolved',
}

export interface EntityEventData {
  entity: Entity;
  previousEntity?: Entity;
  mergedEntities?: Entity[];
  source?: string;
  confidence?: number;
}

export class RolodexService extends Service {
  static serviceType = 'rolodex' as const;

  capabilityDescription = 'Comprehensive contact and relationship management service';

  private initialized: boolean = false;

  // In-memory caches for performance
  private contactInfoCache: Map<UUID, ContactInfo> = new Map();
  private analyticsCache: Map<string, RelationshipAnalytics> = new Map();
  private categoriesCache: ContactCategory[] = [];

  async initialize(runtime: IAgentRuntime): Promise<void> {
    this.runtime = runtime;

    // Initialize default categories
    this.categoriesCache = [
      { id: 'friend', name: 'Friend', color: '#4CAF50' },
      { id: 'family', name: 'Family', color: '#2196F3' },
      { id: 'colleague', name: 'Colleague', color: '#FF9800' },
      { id: 'acquaintance', name: 'Acquaintance', color: '#9E9E9E' },
      { id: 'vip', name: 'VIP', color: '#9C27B0' },
      { id: 'business', name: 'Business', color: '#795548' },
    ];

    // Load existing contact info from components
    await this.loadContactInfoFromComponents();

    this.initialized = true;
    logger.info('[RolodexService] Initialized successfully');
  }

  async stop(): Promise<void> {
    // Clean up caches
    this.contactInfoCache.clear();
    this.analyticsCache.clear();
    this.categoriesCache = [];
    this.initialized = false;
    logger.info('[RolodexService] Stopped successfully');
  }

  static async start(runtime: IAgentRuntime): Promise<Service> {
    const service = new RolodexService();
    await service.initialize(runtime);
    return service;
  }

  private async loadContactInfoFromComponents(): Promise<void> {
    try {
      // Get all rooms for the agent to find entities
      const rooms = await this.runtime.getRooms(stringToUuid('world-' + this.runtime.agentId));
      const entityIds = new Set<UUID>();

      // Collect unique entity IDs from all rooms
      for (const room of rooms) {
        const entities = await this.runtime.getEntitiesForRoom(room.id, true);
        entities.forEach((entity) => entityIds.add(entity.id as UUID));
      }

      // Load contact info from components for each entity
      for (const entityId of entityIds) {
        const components = await this.runtime.getComponents(entityId);
        const contactComponent = components.find(
          (c) => c.type === 'contact_info' && c.agentId === this.runtime.agentId
        );

        if (contactComponent) {
          const contactInfo = contactComponent.data as unknown as ContactInfo;
          this.contactInfoCache.set(entityId, contactInfo);
        }
      }

      logger.info(`[RolodexService] Loaded ${this.contactInfoCache.size} contacts from components`);
    } catch (error) {
      logger.error('[RolodexService] Error loading contact info:', error);
    }
  }

  // Contact Management Methods
  async addContact(
    entityId: UUID,
    categories: string[] = ['acquaintance'],
    preferences?: ContactPreferences,
    customFields?: Record<string, any>
  ): Promise<ContactInfo> {
    const contactInfo: ContactInfo = {
      entityId,
      categories,
      tags: [],
      preferences: preferences || {},
      customFields: customFields || {},
      privacyLevel: 'private',
      lastModified: new Date().toISOString(),
    };

    // Save as component
    await this.runtime.createComponent({
      id: stringToUuid(`contact-${entityId}-${this.runtime.agentId}`),
      type: 'contact_info',
      agentId: this.runtime.agentId,
      entityId,
      roomId: stringToUuid('rolodex-' + this.runtime.agentId),
      worldId: stringToUuid('rolodex-world-' + this.runtime.agentId),
      sourceEntityId: this.runtime.agentId,
      data: contactInfo as unknown as Metadata,
      createdAt: Date.now(),
    });

    this.contactInfoCache.set(entityId, contactInfo);

    // Emit entity lifecycle event
    const entity = await this.runtime.getEntityById(entityId);
    if (entity) {
      const eventData: EntityEventData = {
        entity,
        source: 'rolodex',
      };
      await this.runtime.emitEvent(EntityLifecycleEvent.UPDATED, eventData);
    }

    logger.info(
      `[RolodexService] Added contact ${entityId} with categories: ${categories.join(', ')}`
    );
    return contactInfo;
  }

  async updateContact(entityId: UUID, updates: Partial<ContactInfo>): Promise<ContactInfo | null> {
    const existing = await this.getContact(entityId);
    if (!existing) {
      logger.warn(`[RolodexService] Contact ${entityId} not found`);
      return null;
    }

    const updated: ContactInfo = {
      ...existing,
      ...updates,
      entityId, // Ensure entityId cannot be changed
      lastModified: new Date().toISOString(),
    };

    // Update component
    const components = await this.runtime.getComponents(entityId);
    const contactComponent = components.find(
      (c) => c.type === 'contact_info' && c.agentId === this.runtime.agentId
    );

    if (contactComponent) {
      await this.runtime.updateComponent({
        ...contactComponent,
        data: updated as unknown as Metadata,
      });
    }

    this.contactInfoCache.set(entityId, updated);

    logger.info(`[RolodexService] Updated contact ${entityId}`);
    return updated;
  }

  async getContact(entityId: UUID): Promise<ContactInfo | null> {
    // Check cache first
    if (this.contactInfoCache.has(entityId)) {
      return this.contactInfoCache.get(entityId)!;
    }

    // Load from component if not in cache
    const components = await this.runtime.getComponents(entityId);
    const contactComponent = components.find(
      (c) => c.type === 'contact_info' && c.agentId === this.runtime.agentId
    );

    if (contactComponent) {
      const contactInfo = contactComponent.data as unknown as ContactInfo;
      this.contactInfoCache.set(entityId, contactInfo);
      return contactInfo;
    }

    return null;
  }

  async removeContact(entityId: UUID): Promise<boolean> {
    const existing = await this.getContact(entityId);
    if (!existing) {
      logger.warn(`[RolodexService] Contact ${entityId} not found`);
      return false;
    }

    // Remove component
    const components = await this.runtime.getComponents(entityId);
    const contactComponent = components.find(
      (c) => c.type === 'contact_info' && c.agentId === this.runtime.agentId
    );

    if (contactComponent) {
      await this.runtime.deleteComponent(contactComponent.id);
    }

    // Remove from cache
    this.contactInfoCache.delete(entityId);

    logger.info(`[RolodexService] Removed contact ${entityId}`);
    return true;
  }

  async searchContacts(criteria: {
    categories?: string[];
    tags?: string[];
    searchTerm?: string;
    privacyLevel?: string;
  }): Promise<ContactInfo[]> {
    const results: ContactInfo[] = [];

    for (const [_, contactInfo] of this.contactInfoCache) {
      let matches = true;

      // Check categories
      if (criteria.categories && criteria.categories.length > 0) {
        matches =
          matches && criteria.categories.some((cat) => contactInfo.categories.includes(cat));
      }

      // Check tags
      if (criteria.tags && criteria.tags.length > 0) {
        matches = matches && criteria.tags.some((tag) => contactInfo.tags.includes(tag));
      }

      // Check privacy level
      if (criteria.privacyLevel) {
        matches = matches && contactInfo.privacyLevel === criteria.privacyLevel;
      }

      if (matches) {
        results.push(contactInfo);
      }
    }

    // If searchTerm is provided, further filter by entity names
    if (criteria.searchTerm) {
      const filteredResults: ContactInfo[] = [];
      for (const contact of results) {
        const entity = await this.runtime.getEntityById(contact.entityId);
        if (
          entity &&
          entity.names.some((name) =>
            name.toLowerCase().includes(criteria.searchTerm!.toLowerCase())
          )
        ) {
          filteredResults.push(contact);
        }
      }
      return filteredResults;
    }

    return results;
  }

  // Relationship Analytics Methods
  async analyzeRelationship(
    sourceEntityId: UUID,
    targetEntityId: UUID
  ): Promise<RelationshipAnalytics | null> {
    const cacheKey = `${sourceEntityId}-${targetEntityId}`;

    // Check cache first
    if (this.analyticsCache.has(cacheKey)) {
      const cached = this.analyticsCache.get(cacheKey)!;
      // Cache for 1 hour
      if (
        cached.lastInteractionAt &&
        Date.now() - new Date(cached.lastInteractionAt).getTime() < 3600000
      ) {
        return cached;
      }
    }

    // Get relationship
    const relationships = await this.runtime.getRelationships({
      entityId: sourceEntityId,
    });

    const relationship = relationships.find(
      (r) => r.targetEntityId === targetEntityId || r.sourceEntityId === targetEntityId
    ) as ExtendedRelationship | undefined;

    if (!relationship) {
      return null;
    }

    // Get recent messages between entities
    const messages = await this.runtime.getMemories({
      tableName: 'messages',
      entityId: sourceEntityId,
      count: 100,
    });

    const interactions = messages.filter(
      (m) =>
        m.content.inReplyTo === targetEntityId ||
        (m.entityId === targetEntityId && m.content.inReplyTo === sourceEntityId)
    );

    // Calculate metrics
    const interactionCount = interactions.length;
    const lastInteraction = interactions[0];
    const lastInteractionAt = lastInteraction?.createdAt
      ? new Date(lastInteraction.createdAt).toISOString()
      : undefined;

    // Calculate average response time
    let totalResponseTime = 0;
    let responseCount = 0;

    for (let i = 0; i < interactions.length - 1; i++) {
      const current = interactions[i];
      const next = interactions[i + 1];

      if (current.entityId !== next.entityId && current.createdAt && next.createdAt) {
        const timeDiff = new Date(next.createdAt).getTime() - new Date(current.createdAt).getTime();
        totalResponseTime += timeDiff;
        responseCount++;
      }
    }

    const averageResponseTime = responseCount > 0 ? totalResponseTime / responseCount : undefined;

    // Extract topics (simplified - could use NLP)
    const topicsSet = new Set<string>();
    interactions.forEach((msg) => {
      const text = msg.content.text || '';
      // Simple keyword extraction - could be enhanced with NLP
      const keywords = text.match(/\b[A-Z][a-z]+\b/g) || [];
      keywords.forEach((k) => topicsSet.add(k));
    });

    // Calculate relationship strength
    const strength = calculateRelationshipStrength({
      interactionCount,
      lastInteractionAt,
      relationshipType: relationship.relationshipType,
    });

    const analytics: RelationshipAnalytics = {
      strength,
      interactionCount,
      lastInteractionAt,
      averageResponseTime,
      sentimentScore: 0.7, // Placeholder - could integrate sentiment analysis
      topicsDiscussed: Array.from(topicsSet).slice(0, 10),
    };

    // Update relationship with calculated strength
    if (
      relationship.strength !== strength ||
      relationship.lastInteractionAt !== lastInteractionAt
    ) {
      const updatedRelationship: ExtendedRelationship = {
        ...relationship,
        strength,
        lastInteractionAt,
      };

      // Update relationship using components instead of non-existent updateRelationship
      const relationshipComponent = {
        id: stringToUuid(`relationship-${relationship.id}`),
        type: 'relationship_update',
        agentId: this.runtime.agentId,
        entityId: relationship.sourceEntityId,
        roomId: stringToUuid(`rolodex-${this.runtime.agentId}`),
        worldId: stringToUuid(`rolodex-world-${this.runtime.agentId}`),
        sourceEntityId: relationship.sourceEntityId,
        data: {
          targetEntityId: relationship.targetEntityId,
          strength,
          lastInteractionAt,
          metadata: relationship.metadata,
        } as unknown as Metadata,
        createdAt: Date.now(),
      };
      await this.runtime.createComponent(relationshipComponent);
    }

    // Cache the result
    this.analyticsCache.set(cacheKey, analytics);

    return analytics;
  }

  async getRelationshipInsights(entityId: UUID): Promise<{
    strongestRelationships: Array<{ entity: Entity; analytics: RelationshipAnalytics }>;
    needsAttention: Array<{ entity: Entity; daysSinceContact: number }>;
    recentInteractions: Array<{ entity: Entity; lastInteraction: string }>;
  }> {
    const relationships = await this.runtime.getRelationships({ entityId });
    const insights = {
      strongestRelationships: [] as Array<{ entity: Entity; analytics: RelationshipAnalytics }>,
      needsAttention: [] as Array<{ entity: Entity; daysSinceContact: number }>,
      recentInteractions: [] as Array<{ entity: Entity; lastInteraction: string }>,
    };

    for (const rel of relationships) {
      const targetId = rel.sourceEntityId === entityId ? rel.targetEntityId : rel.sourceEntityId;

      const entity = await this.runtime.getEntityById(targetId);
      if (!entity) continue;

      const analytics = await this.analyzeRelationship(entityId, targetId);
      if (!analytics) continue;

      // Strongest relationships
      if (analytics.strength > 70) {
        insights.strongestRelationships.push({ entity, analytics });
      }

      // Needs attention (no contact in 30+ days)
      if (analytics.lastInteractionAt) {
        const daysSince =
          (Date.now() - new Date(analytics.lastInteractionAt).getTime()) / (1000 * 60 * 60 * 24);

        if (daysSince > 30) {
          insights.needsAttention.push({ entity, daysSinceContact: Math.round(daysSince) });
        }

        // Recent interactions (last 7 days)
        if (daysSince < 7) {
          insights.recentInteractions.push({
            entity,
            lastInteraction: analytics.lastInteractionAt,
          });
        }
      }
    }

    // Sort by relevance
    insights.strongestRelationships.sort((a, b) => b.analytics.strength - a.analytics.strength);
    insights.needsAttention.sort((a, b) => b.daysSinceContact - a.daysSinceContact);
    insights.recentInteractions.sort(
      (a, b) => new Date(b.lastInteraction).getTime() - new Date(a.lastInteraction).getTime()
    );

    return insights;
  }

  // Category Management
  async getCategories(): Promise<ContactCategory[]> {
    return this.categoriesCache;
  }

  async addCategory(category: ContactCategory): Promise<void> {
    if (this.categoriesCache.find((c) => c.id === category.id)) {
      throw new Error(`Category ${category.id} already exists`);
    }

    this.categoriesCache.push(category);
    logger.info(`[RolodexService] Added category: ${category.name}`);
  }

  // Privacy Management
  async setContactPrivacy(
    entityId: UUID,
    privacyLevel: 'public' | 'private' | 'restricted'
  ): Promise<boolean> {
    const contact = await this.getContact(entityId);
    if (!contact) return false;

    contact.privacyLevel = privacyLevel;
    await this.updateContact(entityId, { privacyLevel });

    logger.info(`[RolodexService] Set privacy level for ${entityId} to ${privacyLevel}`);
    return true;
  }

  async canAccessContact(requestingEntityId: UUID, targetEntityId: UUID): Promise<boolean> {
    const contact = await this.getContact(targetEntityId);
    if (!contact) return false;

    // Agent always has access
    if (requestingEntityId === this.runtime.agentId) return true;

    // Check privacy level
    switch (contact.privacyLevel) {
      case 'public':
        return true;
      case 'private':
        // Only agent and the entity itself
        return requestingEntityId === targetEntityId;
      case 'restricted':
        // Only agent
        return false;
      default:
        return false;
    }
  }
}
