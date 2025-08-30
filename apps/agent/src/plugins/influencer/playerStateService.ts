import { IAgentRuntime, Service, UUID } from "@elizaos/core";

export interface PlayerPhaseFlags {
  mustIntroduce: boolean;
  introduced: boolean;
  diaryPending: boolean;
  diaryResponded: boolean;
  updatedAt: number;
}

export class PlayerStateService extends Service {
  static serviceType = "influencer-player-state";
  capabilityDescription =
    "Tracks per-room player phase flags for response gating";

  private flagsByRoom: Map<UUID, PlayerPhaseFlags> = new Map();

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  private ensure(roomId: UUID): PlayerPhaseFlags {
    if (!this.flagsByRoom.has(roomId)) {
      this.flagsByRoom.set(roomId, {
        mustIntroduce: false,
        introduced: false,
        diaryPending: false,
        diaryResponded: false,
        updatedAt: Date.now(),
      });
    }
    return this.flagsByRoom.get(roomId)!;
  }

  async markIntroductionRequired(roomId: UUID): Promise<void> {
    const f = this.ensure(roomId);
    f.mustIntroduce = true;
    f.introduced = false;
    f.updatedAt = Date.now();
  }

  async markIntroduced(roomId: UUID): Promise<void> {
    const f = this.ensure(roomId);
    f.introduced = true;
    f.mustIntroduce = false;
    f.updatedAt = Date.now();
  }

  async setDiaryPending(roomId: UUID): Promise<void> {
    const f = this.ensure(roomId);
    f.diaryPending = true;
    f.diaryResponded = false;
    f.updatedAt = Date.now();
  }

  async markDiaryResponded(roomId: UUID): Promise<void> {
    const f = this.ensure(roomId);
    f.diaryResponded = true;
    f.diaryPending = false;
    f.updatedAt = Date.now();
  }

  async handleOwnMessageSent(roomId: UUID): Promise<void> {
    const f = this.ensure(roomId);
    if (f.mustIntroduce && !f.introduced) {
      await this.markIntroduced(roomId);
      return;
    }
    if (f.diaryPending && !f.diaryResponded) {
      await this.markDiaryResponded(roomId);
      return;
    }
  }

  getFlags(roomId: UUID): PlayerPhaseFlags {
    return this.ensure(roomId);
  }

  static async start(runtime: IAgentRuntime): Promise<PlayerStateService> {
    const svc = new PlayerStateService(runtime);
    return svc;
  }

  async stop(): Promise<void> {
    // Clean up resources
    this.flagsByRoom.clear();
  }
}
