import { type Provider, type IAgentRuntime, type Memory, type State, logger } from '@elizaos/core';
import { FollowUpService } from '../services/FollowUpService';

export const followUpsProvider: Provider = {
  name: 'FOLLOW_UPS',
  description: 'Provides information about upcoming follow-ups and reminders',
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    try {
      const followUpService = runtime.getService('follow_up') as FollowUpService;
      if (!followUpService) {
        logger.warn('[FollowUpsProvider] FollowUpService not available');
        return { text: '' };
      }

      // Get upcoming follow-ups for the next 7 days
      const upcomingFollowUps = await followUpService.getUpcomingFollowUps(7, true);

      if (upcomingFollowUps.length === 0) {
        return {
          text: 'No upcoming follow-ups scheduled.',
          values: { followUpCount: 0, followUps: [] },
        };
      }

      // Separate overdue and upcoming
      const now = Date.now();
      const overdue = upcomingFollowUps.filter((f) => {
        const scheduledAt = f.task.metadata?.scheduledAt
          ? new Date(f.task.metadata.scheduledAt as string).getTime()
          : 0;
        return scheduledAt < now;
      });

      const upcoming = upcomingFollowUps.filter((f) => {
        const scheduledAt = f.task.metadata?.scheduledAt
          ? new Date(f.task.metadata.scheduledAt as string).getTime()
          : 0;
        return scheduledAt >= now;
      });

      // Build text summary
      let textSummary = `You have ${upcomingFollowUps.length} follow-up${upcomingFollowUps.length !== 1 ? 's' : ''} scheduled:\n`;

      if (overdue.length > 0) {
        textSummary += `\nOverdue (${overdue.length}):\n`;
        for (const f of overdue) {
          const entity = await runtime.getEntityById(f.contact.entityId);
          const name = entity?.names[0] || 'Unknown';
          const scheduledAt = f.task.metadata?.scheduledAt
            ? new Date(f.task.metadata.scheduledAt as string)
            : null;

          textSummary += `- ${name}`;
          if (scheduledAt) {
            const daysOverdue = Math.floor((now - scheduledAt.getTime()) / (1000 * 60 * 60 * 24));
            textSummary += ` (${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue)`;
          }
          if (f.task.metadata?.reason) {
            textSummary += ` - ${f.task.metadata.reason}`;
          }
          textSummary += '\n';
        }
      }

      if (upcoming.length > 0) {
        textSummary += `\nUpcoming (${upcoming.length}):\n`;
        for (const f of upcoming) {
          const entity = await runtime.getEntityById(f.contact.entityId);
          const name = entity?.names[0] || 'Unknown';
          const scheduledAt = f.task.metadata?.scheduledAt
            ? new Date(f.task.metadata.scheduledAt as string)
            : null;

          textSummary += `- ${name}`;
          if (scheduledAt) {
            const daysUntil = Math.ceil((scheduledAt.getTime() - now) / (1000 * 60 * 60 * 24));
            if (daysUntil === 0) {
              textSummary += ' (today)';
            } else if (daysUntil === 1) {
              textSummary += ' (tomorrow)';
            } else {
              textSummary += ` (in ${daysUntil} days)`;
            }
          }
          if (f.task.metadata?.reason) {
            textSummary += ` - ${f.task.metadata.reason}`;
          }
          textSummary += '\n';
        }
      }

      // Get follow-up suggestions
      const suggestions = await followUpService.getFollowUpSuggestions();

      if (suggestions.length > 0) {
        textSummary += `\nSuggested follow-ups:\n`;
        suggestions.slice(0, 3).forEach((s) => {
          textSummary += `- ${s.entityName} (${s.daysSinceLastContact} days since last contact)\n`;
        });
      }

      return {
        text: textSummary.trim(),
        values: {
          followUpCount: upcomingFollowUps.length,
          overdueCount: overdue.length,
          upcomingCount: upcoming.length,
          suggestionsCount: suggestions.length,
        },
        data: {
          followUps: upcomingFollowUps.map((f) => ({
            taskId: f.task.id,
            contactId: f.contact.entityId,
            scheduledAt: f.task.metadata?.scheduledAt,
            reason: f.task.metadata?.reason,
            priority: f.task.metadata?.priority,
          })),
          suggestions: suggestions.slice(0, 5),
        },
      };
    } catch (error) {
      logger.error('[FollowUpsProvider] Error getting follow-ups:', error);
      return { text: 'Error retrieving follow-up information.' };
    }
  },
};
