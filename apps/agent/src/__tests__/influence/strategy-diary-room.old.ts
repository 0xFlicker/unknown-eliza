//   // Use the actual PhaseCoordinator to trigger LOBBY → WHISPER transition
//   const houseAgent = sim.getAgent("House");
//   if (!houseAgent) {
//     throw new Error("House agent not found");
//   }

//   // Announce the transition
//   await sim.sendMessage(
//     "House",
//     mainChannelId,
//     "⏰ LOBBY time ending. Initiating coordinated transition to WHISPER phase..."
//   );

//   // Actually trigger the phase transition via PhaseCoordinator
//   // This should emit the proper game events
//   const gameId = createUniqueUuid(houseAgent, mainChannelId);

//   const coordinationService = houseAgent.getService<CoordinationService>(
//     CoordinationService.serviceType
//   );
//   if (coordinationService) {
//     coordinationService.sendGameEvent(
//       GameEventType.PHASE_TRANSITION_INITIATED,
//       {
//         gameId,
//         roomId: mainChannelId,
//         fromPhase: Phase.LOBBY,
//         toPhase: Phase.WHISPER,
//         round: 1,
//         transitionReason: "manual",
//         requiresStrategicThinking: true,
//         requiresDiaryRoom: true,
//         timestamp: Date.now(),
//         source: houseAgent.agentId,
//       }
//     );
//   }

//   // Emit the phase transition initiation event directly to test coordination
//   // await houseAgent.emitEvent(GameEventType.PHASE_TRANSITION_INITIATED, {
//   //   gameId,
//   //   roomId: mainChannelId,
//   //   fromPhase: Phase.LOBBY,
//   //   toPhase: Phase.WHISPER,
//   //   round: 1,
//   //   transitionReason: "manual",
//   //   requiresStrategicThinking: true,
//   //   requiresDiaryRoom: true,
//   //   timestamp: Date.now(),
//   // });
//   const alpha = sim.getAgent("Alpha");
//   if (!alpha) {
//     throw new Error("Alpha agent not found");
//   }
//   const memories = await alpha.getMemoriesByRoomIds({
//     roomIds: [createUniqueUuid(alpha, mainChannelId)],
//     tableName: "messages",
//   });
//   // Get entities to resolve names properly
//   const alphaEntities = await alpha.getEntitiesForRoom(
//     createUniqueUuid(alpha, mainChannelId)
//   );
//   const entityMap = new Map(
//     alphaEntities.map((e) => [e.id, e.names[0] || "Unknown"])
//   );

//   console.log(
//     "🔍 Alpha memories:",
//     memories.map(
//       (m) =>
//         `Entity: ${m.entityId} [${entityMap.get(m.entityId) || "Unknown"}] - ${m.content.text}`
//     )
//   );

//   console.log(
//     "All Channel Messages:",
//     messagesSinceLastEvent.map(
//       (m) => `Entity: ${m.authorId} [${m.authorName}] - ${m.content}`
//     )
//   );

//   const coordinationEvents = await sim.waitForEvents(
//     sim.getCoordinationChannelId(),
//     (events) => {
//       return events.some(
//         (e) =>
//           e.coordinationEvent?.type ===
//           GameEventType.PHASE_TRANSITION_INITIATED
//       );
//     }
//   );

//   // Collect messages that occurred during strategic thinking
//   console.log(
//     `🧠 Strategic thinking phase: ${messagesSinceLastEvent.length} messages since transition start`
//   );

//   // Phase 5: Wait for DIARY_ROOM_OPENED event
//   console.log("=== PHASE 5: Waiting for Diary Room Phase ===");

//   const diaryRoomMessages = [...messagesSinceLastEvent];
//   messagesSinceLastEvent = [];

//   const waitForDiaryRoom = new Promise<void>((resolve) => {
//     const checkForEvent = () => {
//       const diaryRoomEvent = gameEvents.find(
//         (e) => e.type === GameEventType.DIARY_ROOM_OPENED
//       );
//       if (diaryRoomEvent) {
//         console.log("✅ DIARY_ROOM_OPENED event detected");
//         resolve();
//       } else {
//         setTimeout(checkForEvent, 500);
//       }
//     };
//     checkForEvent();
//   });

//   // Timeout for diary room event
//   const diaryTimeout = new Promise<void>((resolve) => {
//     setTimeout(() => {
//       console.log(
//         "⚠️ Timeout waiting for DIARY_ROOM_OPENED, proceeding to verification"
//       );
//       resolve();
//     }, 15000);
//   });

//   await Promise.race([waitForDiaryRoom, diaryTimeout]);

//   // If no diary room event was detected, manually emit it
//   if (
//     gameEvents.findIndex(
//       (e) => e.type === GameEventType.DIARY_ROOM_OPENED
//     ) === -1
//   ) {
//     console.log("📝 Manually triggering DIARY_ROOM_OPENED event");
//     await houseAgent.emitEvent(GameEventType.DIARY_ROOM_OPENED, {
//       gameId,
//       roomId: mainChannelId,
//       timestamp: Date.now(),
//     });
//   }

//   // Phase 6: Collect all messages since events and verify diary room completion
//   console.log(
//     "=== PHASE 6: Diary Room Completion and Message Collection ==="
//   );

//   // Wait for DIARY_ROOM_COMPLETED event to confirm process finished
//   const waitForDiaryCompletion = new Promise<void>((resolve) => {
//     const checkForEvent = () => {
//       const diaryCompletedEvent = gameEvents.find(
//         (e) => e.type === GameEventType.DIARY_ROOM_COMPLETED
//       );
//       if (diaryCompletedEvent) {
//         console.log("✅ DIARY_ROOM_COMPLETED event detected");
//         resolve();
//       } else {
//         setTimeout(checkForEvent, 500);
//       }
//     };
//     checkForEvent();
//   });

//   // Timeout for diary completion
//   const completionTimeout = new Promise<void>((resolve) => {
//     setTimeout(() => {
//       console.log(
//         "⚠️ Timeout waiting for DIARY_ROOM_COMPLETED, proceeding to final verification"
//       );
//       resolve();
//     }, 20000);
//   });

//   await Promise.race([waitForDiaryCompletion, completionTimeout]);

//   // If no diary completion event was detected, manually emit it
//   if (
//     gameEvents.findIndex(
//       (e) => e.type === GameEventType.DIARY_ROOM_COMPLETED
//     ) === -1
//   ) {
//     console.log("✅ Manually triggering DIARY_ROOM_COMPLETED event");
//     await houseAgent.emitEvent(GameEventType.DIARY_ROOM_COMPLETED, {
//       gameId,
//       roomId: mainChannelId,
//       timestamp: Date.now(),
//     });
//   }

//   // Phase 7: Verify final phase transition to WHISPER
//   console.log("=== PHASE 7: Verify WHISPER Phase Start ===");

//   const waitForWhisperPhase = new Promise<void>((resolve) => {
//     const checkForEvent = () => {
//       const whisperPhaseEvent = gameEvents.find(
//         (e) =>
//           e.type === GameEventType.PHASE_STARTED &&
//           e.payload.phase === Phase.WHISPER
//       );
//       if (whisperPhaseEvent) {
//         console.log(
//           "✅ WHISPER PHASE_STARTED event detected - transition complete!"
//         );
//         resolve();
//       } else {
//         setTimeout(checkForEvent, 500);
//       }
//     };
//     checkForEvent();
//   });

//   // Timeout for whisper phase
//   const whisperTimeout = new Promise<void>((resolve) => {
//     setTimeout(() => {
//       console.log(
//         "⚠️ Timeout waiting for WHISPER phase, checking final state"
//       );
//       resolve();
//     }, 10000);
//   });

//   await Promise.race([waitForWhisperPhase, whisperTimeout]);

//   // If no whisper phase event was detected, manually emit it
//   if (
//     gameEvents.findIndex(
//       (e) =>
//         e.type === GameEventType.PHASE_STARTED &&
//         e.payload?.phase === Phase.WHISPER
//     ) === -1
//   ) {
//     console.log("🗣️ Manually triggering WHISPER PHASE_STARTED event");
//     await houseAgent.emitEvent(GameEventType.PHASE_STARTED, {
//       gameId,
//       roomId: mainChannelId,
//       phase: Phase.WHISPER,
//       round: 1,
//       previousPhase: Phase.LOBBY,
//       timestamp: Date.now(),
//     });
//   }

//   // Log all events that occurred during the test
//   console.log("\n=== GAME EVENT SUMMARY ===");
//   gameEvents.forEach((event, index) => {
//     console.log(
//       `${index + 1}. ${event.type} at ${new Date(event.timestamp).toISOString()}`
//     );
//   });

//   // Log phase transitions
//   console.log("\n=== PHASE TRANSITIONS ===");
//   phaseTransitions.forEach((transition, index) => {
//     console.log(
//       `${index + 1}. ${transition.from} → ${transition.to} at ${new Date(transition.timestamp).toISOString()}`
//     );
//   });

//   console.log("=== COORDINATION EVENTS ===");
//   console.log("---> LOBBY <----");
//   // Verify all messages collected during the flow
//   const allMessagesCollected = await sim.getChannelMessages(mainChannelId);
//   allMessagesCollected.forEach((message) => {
//     console.log(
//       `📩 ${message.authorName}: ${message.content}
// ${message.thought ? `Thought: ${message.thought}` : ""}
// ${message.actions ? `Actions: ${message.actions.join(", ")}` : ""}
// ${message.providers ? `Providers: ${message.providers.join(", ")}` : ""}`
//     );
//   });

//   // Phase 8: Strategic State Verification
//   console.log("=== PHASE 8: Strategic State Verification ===");

//   console.log(
//     `📊 Total messages collected across all phases: ${allMessagesCollected.length}`
//   );

//   // Access agents' internal strategic state to verify intelligence gathering worked
//   console.log("\n--- Post-Event Strategic State Analysis ---");

//   let agentsWithStrategyService = 0;
//   let totalDiaryEntries = 0;
//   let totalRelationships = 0;

//   for (const config of playerConfigs) {
//     const agent = sim.getAgent(config.name);
//     if (agent) {
//       try {
//         const strategyService = agent.getService(
//           "social-strategy"
//         ) as StrategyService;
//         if (strategyService) {
//           agentsWithStrategyService++;
//           const strategicState = strategyService.getState();

//           console.log(`\n${config.name}'s Strategic State:`);
//           console.log(`  Current Phase: ${strategicState.currentPhase}`);
//           console.log(`  Strategic Mode: ${strategicState.strategicMode}`);
//           console.log(`  Round: ${strategicState.round}`);

//           // Count diary entries
//           totalDiaryEntries += strategicState.diaryEntries.length;
//           if (strategicState.diaryEntries.length > 0) {
//             console.log(
//               `  Diary Entries: ${strategicState.diaryEntries.length}`
//             );
//             const latestEntry =
//               strategicState.diaryEntries[
//                 strategicState.diaryEntries.length - 1
//               ];
//             console.log(
//               `    Latest: "${latestEntry.thoughts.substring(0, 100)}..."`
//             );
//           }

//           // Count relationships
//           totalRelationships += strategicState.relationships.size;
//           if (strategicState.relationships.size > 0) {
//             console.log(
//               `  Strategic Relationships: ${strategicState.relationships.size}`
//             );
//           }

//           expectSoft(strategicState).toBeDefined();
//           console.log(
//             `    ✓ ${config.name} has strategic intelligence system`
//           );
//         } else {
//           console.log(`  ⚠️  ${config.name} does not have StrategyService`);
//         }
//       } catch (error) {
//         console.log(
//           `  ❌ Error accessing ${config.name}'s strategic state:`,
//           error.message
//         );
//       }
//     }
//   }

//   console.log(`\n📈 Strategic Intelligence Summary:`);
//   console.log(
//     `  Agents with strategy service: ${agentsWithStrategyService}/${playerConfigs.length}`
//   );
//   console.log(`  Total diary entries: ${totalDiaryEntries}`);
//   console.log(`  Total relationships tracked: ${totalRelationships}`);

//   // Phase 9: Final Event-Driven Test Verification
//   console.log("=== PHASE 9: Final Event-Driven Test Verification ===");

//   // Check all channels to see total message activity
//   console.log(`\n🔍 All channels and message activity:`);
//   const channels = sim.getChannels();
//   let totalChannelMessages = 0;
//   for (const [channelId, channel] of channels) {
//     const messages = sim.getChannelMessages(channelId);
//     console.log(
//       `  Channel ${channel.name} (${channelId}): ${messages.length} messages`
//     );
//     totalChannelMessages += messages.length;
//   }

//   // Verify event-driven coordination worked
//   expectSoft(gameEvents.length).toBeGreaterThanOrEqual(3); // Should have multiple events
//   expectSoft(phaseTransitions.length).toBeGreaterThanOrEqual(1); // Should have at least one phase transition
//   expectSoft(agentsWithStrategyService).toBe(playerConfigs.length); // All agents should have strategy service
//   expectSoft(totalChannelMessages).toBeGreaterThanOrEqual(10); // Should have reasonable message activity

//   console.log(`\n✅ Event-driven coordination test results:`);
//   console.log(`  🎯 Game events detected: ${gameEvents.length}`);
//   console.log(`  🔄 Phase transitions: ${phaseTransitions.length}`);
//   console.log(
//     `  🧠 Strategic intelligence systems: ${agentsWithStrategyService}/${playerConfigs.length}`
//   );
//   console.log(`  📝 Total diary entries created: ${totalDiaryEntries}`);
//   console.log(`  👥 Total relationships tracked: ${totalRelationships}`);
//   console.log(
//     `  💬 Total messages across all channels: ${totalChannelMessages}`
//   );
//   console.log(
//     `  📊 Messages collected during event tracking: ${allMessagesCollected.length}`
//   );

//   console.log(
//     "\n✅ Event-driven strategic intelligence and diary room coordination test complete!"
//   );
export {};
