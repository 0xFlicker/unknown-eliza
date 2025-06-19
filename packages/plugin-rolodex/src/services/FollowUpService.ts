import {
  type IAgentRuntime,
  Service,
  type UUID,
  type Task,
  type TaskWorker,
  logger,
  stringToUuid,
  createUniqueUuid,
  type Memory,
  ChannelType,
  ContentType,
} from '@elizaos/core';
import { RolodexService, type ContactInfo } from './RolodexService';

export interface FollowUpTask {
  entityId: UUID;
  reason: string;
  message?: string;
  priority: 'high' | 'medium' | 'low';
  metadata?: Record<string, any>;
}

export interface FollowUpSuggestion {
  entityId: UUID;
  entityName: string;
  reason: string;
  daysSinceLastContact: number;
  relationshipStrength: number;
  suggestedMessage?: string;
}

export class FollowUpService extends Service {
  static serviceType = 'follow_up' as const;

  capabilityDescription = 'Task-based follow-up scheduling and management for contacts';

  private rolodexService: RolodexService | null = null;

  async initialize(runtime: IAgentRuntime): Promise<void> {
    this.runtime = runtime;

    // Get reference to RolodexService
    this.rolodexService = runtime.getService('rolodex') as RolodexService;
    if (!this.rolodexService) {
      throw new Error('[FollowUpService] RolodexService must be initialized first');
    }

    // Register task workers
    this.registerFollowUpWorker();
    this.registerRecurringCheckInWorker();

    logger.info('[FollowUpService] Initialized successfully');
  }

  async stop(): Promise<void> {
    this.rolodexService = null;
    logger.info('[FollowUpService] Stopped successfully');
  }

  static async start(runtime: IAgentRuntime): Promise<Service> {
    const service = new FollowUpService();
    await service.initialize(runtime);
    return service;
  }

  // Follow-up Scheduling Methods
  async scheduleFollowUp(
    entityId: UUID,
    scheduledAt: Date,
    reason: string,
    priority: 'high' | 'medium' | 'low' = 'medium',
    message?: string
  ): Promise<Task> {
    // Ensure contact exists
    const contact = await this.rolodexService?.getContact(entityId);
    if (!contact) {
      throw new Error(`Contact ${entityId} not found`);
    }

    // Create follow-up task
    const task: Task = {
      id: createUniqueUuid(this.runtime, `followup-${entityId}-${Date.now()}`),
      name: 'follow_up',
      description: `Follow-up with contact: ${reason}`,
      entityId: this.runtime.agentId,
      roomId: stringToUuid(`rolodex-${this.runtime.agentId}`),
      worldId: stringToUuid(`rolodex-world-${this.runtime.agentId}`),
      tags: ['follow-up', priority, 'rolodex'],
      metadata: {
        targetEntityId: entityId,
        reason,
        priority,
        message,
        scheduledAt: scheduledAt.toISOString(),
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    };

    // Save task
    await this.runtime.createTask(task);

    // Update contact with next follow-up
    await this.rolodexService?.updateContact(entityId, {
      customFields: {
        ...contact.customFields,
        nextFollowUpAt: scheduledAt.toISOString(),
        nextFollowUpReason: reason,
      },
    });

    logger.info(
      `[FollowUpService] Scheduled follow-up for ${entityId} at ${scheduledAt.toISOString()}`
    );
    return task;
  }

  async getUpcomingFollowUps(
    days: number = 7,
    includeOverdue: boolean = true
  ): Promise<Array<{ task: Task; contact: ContactInfo }>> {
    const now = Date.now();
    const futureDate = now + days * 24 * 60 * 60 * 1000;

    // Get all follow-up tasks
    const tasks = await this.runtime.getTasks({
      entityId: this.runtime.agentId,
      tags: ['follow-up'],
    });

    const upcomingFollowUps: Array<{ task: Task; contact: ContactInfo }> = [];

    for (const task of tasks) {
      if (task.metadata?.status !== 'pending') continue;

      const scheduledAt = task.metadata?.scheduledAt
        ? new Date(task.metadata.scheduledAt as string).getTime()
        : 0;

      // Check if task is within the time range
      if (includeOverdue && scheduledAt < now) {
        // Overdue task
      } else if (scheduledAt >= now && scheduledAt <= futureDate) {
        // Upcoming task
      } else {
        continue;
      }

      // Get contact info
      const targetEntityId = task.metadata?.targetEntityId as UUID;
      if (targetEntityId) {
        const contact = await this.rolodexService?.getContact(targetEntityId);
        if (contact) {
          upcomingFollowUps.push({ task, contact });
        }
      }
    }

    // Sort by scheduled date
    upcomingFollowUps.sort((a, b) => {
      const aScheduled = a.task.metadata?.scheduledAt
        ? new Date(a.task.metadata.scheduledAt as string).getTime()
        : 0;
      const bScheduled = b.task.metadata?.scheduledAt
        ? new Date(b.task.metadata.scheduledAt as string).getTime()
        : 0;
      return aScheduled - bScheduled;
    });

    return upcomingFollowUps;
  }

  async completeFollowUp(taskId: UUID, notes?: string): Promise<void> {
    const task = await this.runtime.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Update task metadata
    await this.runtime.updateTask(taskId, {
      metadata: {
        ...task.metadata,
        status: 'completed',
        completedAt: new Date().toISOString(),
        completionNotes: notes,
      },
    });

    // Clear next follow-up from contact
    const targetEntityId = task.metadata?.targetEntityId as UUID;
    if (targetEntityId) {
      const contact = await this.rolodexService?.getContact(targetEntityId);
      if (contact) {
        const customFields = { ...contact.customFields };
        delete customFields.nextFollowUpAt;
        delete customFields.nextFollowUpReason;

        await this.rolodexService?.updateContact(targetEntityId, { customFields });
      }
    }

    logger.info(`[FollowUpService] Completed follow-up task ${taskId}`);
  }

  async snoozeFollowUp(taskId: UUID, newDate: Date): Promise<void> {
    const task = await this.runtime.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Update task metadata
    await this.runtime.updateTask(taskId, {
      metadata: {
        ...task.metadata,
        scheduledAt: newDate.toISOString(),
        snoozedAt: new Date().toISOString(),
        originalScheduledAt: task.metadata?.scheduledAt || task.metadata?.createdAt,
      },
    });

    // Update contact
    const targetEntityId = task.metadata?.targetEntityId as UUID;
    if (targetEntityId) {
      const contact = await this.rolodexService?.getContact(targetEntityId);
      if (contact) {
        await this.rolodexService?.updateContact(targetEntityId, {
          customFields: {
            ...contact.customFields,
            nextFollowUpAt: newDate.toISOString(),
          },
        });
      }
    }

    logger.info(`[FollowUpService] Snoozed follow-up ${taskId} to ${newDate.toISOString()}`);
  }

  // Smart Follow-up Suggestions
  async getFollowUpSuggestions(): Promise<FollowUpSuggestion[]> {
    if (!this.rolodexService) return [];

    const suggestions: FollowUpSuggestion[] = [];

    // Get all contacts
    const contacts = await this.rolodexService.searchContacts({});

    for (const contact of contacts) {
      const entity = await this.runtime.getEntityById(contact.entityId);
      if (!entity) continue;

      // Get relationship insights
      const insights = await this.rolodexService.getRelationshipInsights(this.runtime.agentId);

      // Check if this entity needs attention
      const needsAttention = insights.needsAttention.find(
        (item) => item.entity.id === contact.entityId
      );

      if (needsAttention && needsAttention.daysSinceContact > 14) {
        // Get relationship analytics
        const analytics = await this.rolodexService.analyzeRelationship(
          this.runtime.agentId,
          contact.entityId
        );

        if (analytics) {
          suggestions.push({
            entityId: contact.entityId,
            entityName: entity.names[0] || 'Unknown',
            reason: this.generateFollowUpReason(
              contact.categories,
              needsAttention.daysSinceContact,
              analytics.strength
            ),
            daysSinceLastContact: needsAttention.daysSinceContact,
            relationshipStrength: analytics.strength,
            suggestedMessage: this.generateFollowUpMessage(
              entity.names[0],
              contact.categories,
              needsAttention.daysSinceContact
            ),
          });
        }
      }
    }

    // Sort by priority (high relationship strength + long time since contact)
    suggestions.sort((a, b) => {
      const scoreA = (a.relationshipStrength / 100) * a.daysSinceLastContact;
      const scoreB = (b.relationshipStrength / 100) * b.daysSinceLastContact;
      return scoreB - scoreA;
    });

    return suggestions.slice(0, 10); // Return top 10 suggestions
  }

  // Task Workers
  private registerFollowUpWorker(): void {
    const worker: TaskWorker = {
      name: 'follow_up',
      validate: async (runtime: IAgentRuntime, message: Memory) => {
        // This validate function is for action/evaluator use, not for task execution
        return true;
      },
      execute: async (runtime: IAgentRuntime, options: { [key: string]: unknown }, task: Task) => {
        try {
          const targetEntityId = task.metadata?.targetEntityId as UUID;
          const message = (task.metadata?.message as string) || 'Time for a follow-up!';

          // Get entity
          const entity = await runtime.getEntityById(targetEntityId);
          if (!entity) {
            logger.warn(`[FollowUpService] Entity ${targetEntityId} not found for follow-up`);
            return;
          }

          // Create a follow-up memory/reminder
          const memory: Memory = {
            id: createUniqueUuid(runtime, `followup-memory-${Date.now()}`),
            entityId: runtime.agentId,
            agentId: runtime.agentId,
            roomId: stringToUuid(`rolodex-${runtime.agentId}`),
            content: {
              text: `Follow-up reminder: ${entity.names[0]} - ${task.metadata?.reason || 'Check in'}. ${message}`,
              type: 'follow_up_reminder',
              metadata: {
                targetEntityId,
                taskId: task.id,
                priority: task.metadata?.priority || 'medium',
              },
            },
            createdAt: Date.now(),
          };

          // Save the reminder
          await runtime.createMemory(memory, 'reminders');

          // Emit follow-up event
          await runtime.emitEvent('follow_up:due', {
            task,
            entity,
            message,
          });

          logger.info(`[FollowUpService] Executed follow-up for ${entity.names[0]}`);
        } catch (error) {
          logger.error('[FollowUpService] Error executing follow-up:', error);
          throw error;
        }
      },
    };

    this.runtime.registerTaskWorker(worker);
  }

  private registerRecurringCheckInWorker(): void {
    const worker: TaskWorker = {
      name: 'recurring_check_in',
      validate: async (runtime: IAgentRuntime, message: Memory) => {
        return true;
      },
      execute: async (runtime: IAgentRuntime, options: { [key: string]: unknown }, task: Task) => {
        try {
          // Execute the check-in (similar to follow-up)
          const followUpWorker = runtime.getTaskWorker('follow_up');
          if (followUpWorker) {
            await followUpWorker.execute(runtime, options, task);
          }

          // Schedule next occurrence if updateInterval is set
          if (task.metadata?.updateInterval) {
            const updateInterval = task.metadata.updateInterval as number;
            const nextDate = new Date(Date.now() + updateInterval);

            await runtime.updateTask(task.id!, {
              metadata: {
                ...task.metadata,
                scheduledAt: nextDate.toISOString(),
                lastExecuted: new Date().toISOString(),
              },
            });

            logger.info(`[FollowUpService] Scheduled next check-in for ${nextDate.toISOString()}`);
          }
        } catch (error) {
          logger.error('[FollowUpService] Error executing recurring check-in:', error);
          throw error;
        }
      },
    };

    this.runtime.registerTaskWorker(worker);
  }

  // Helper Methods
  private generateFollowUpReason(
    categories: string[],
    daysSince: number,
    relationshipStrength: number
  ): string {
    if (categories.includes('family') && daysSince > 30) {
      return "It's been over a month since you checked in with family";
    }

    if (categories.includes('friend') && relationshipStrength > 70) {
      return 'Maintain this strong friendship with regular contact';
    }

    if (categories.includes('colleague') && daysSince > 60) {
      return 'Professional relationships benefit from periodic check-ins';
    }

    if (categories.includes('vip')) {
      return 'VIP contact - priority follow-up recommended';
    }

    return `No contact for ${daysSince} days`;
  }

  private generateFollowUpMessage(name: string, categories: string[], daysSince: number): string {
    if (categories.includes('family')) {
      return `Hey ${name}, thinking of you! How have you been?`;
    }

    if (categories.includes('friend')) {
      return `Hi ${name}! It's been a while - would love to catch up!`;
    }

    if (categories.includes('colleague')) {
      return `Hi ${name}, hope you're doing well. Any updates on your projects?`;
    }

    return `Hi ${name}, just wanted to check in and see how you're doing!`;
  }

  // Bulk Operations
  async scheduleMultipleFollowUps(
    followUps: Array<{
      entityId: UUID;
      scheduledAt: Date;
      reason: string;
      priority?: 'high' | 'medium' | 'low';
      message?: string;
    }>
  ): Promise<Task[]> {
    const tasks: Task[] = [];

    for (const followUp of followUps) {
      try {
        const task = await this.scheduleFollowUp(
          followUp.entityId,
          followUp.scheduledAt,
          followUp.reason,
          followUp.priority || 'medium',
          followUp.message
        );
        tasks.push(task);
      } catch (error) {
        logger.error(
          `[FollowUpService] Error scheduling follow-up for ${followUp.entityId}:`,
          error
        );
      }
    }

    logger.info(`[FollowUpService] Scheduled ${tasks.length} follow-ups`);
    return tasks;
  }
}
