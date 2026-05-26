function splitParticipants(participantsText) {
  return participantsText
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
}

async function getRaffleCandidates(db, raffleId, manualParticipantsText) {
  const manualParticipants = splitParticipants(manualParticipantsText || "").map((name) => ({
    name,
    cpfNormalized: ""
  }));
  const publicEntries = await db.all(
    `
      SELECT participant_name, participant_cpf_normalized
      FROM raffle_entries
      WHERE raffle_id = ?
      ORDER BY id ASC
    `,
    [raffleId]
  );

  const publicParticipants = publicEntries
    .map((entry) => ({
      name: String(entry.participant_name || "").trim(),
      cpfNormalized: String(entry.participant_cpf_normalized || "").trim()
    }))
    .filter((entry) => entry.name);

  return [...manualParticipants, ...publicParticipants];
}

function randomWinner(participants) {
  if (!participants.length) {
    return {
      name: "SEM PARTICIPANTES",
      cpfNormalized: ""
    };
  }

  const winnerIndex = Math.floor(Math.random() * participants.length);
  return participants[winnerIndex];
}

async function drawRaffle(db, raffleId, storeId, trigger) {
  const raffle = await db.get(
    `
      SELECT id, store_id, title, participants, drawn_at
      FROM raffles
      WHERE id = ? AND store_id = ?
    `,
    [raffleId, storeId]
  );

  if (!raffle) {
    return { ok: false, reason: "SORTEIO_NAO_ENCONTRADO" };
  }

  if (raffle.drawn_at) {
    return { ok: false, reason: "SORTEIO_JA_REALIZADO" };
  }

  const participants = await getRaffleCandidates(db, raffle.id, raffle.participants);
  const winner = randomWinner(participants);

  await db.run(
    `
      UPDATE raffles
      SET winner_name = ?, winner_cpf_normalized = ?, drawn_at = datetime('now'), draw_trigger = ?
      WHERE id = ? AND store_id = ? AND drawn_at IS NULL
    `,
    [winner.name, winner.cpfNormalized, trigger, raffleId, storeId]
  );

  return { ok: true, winner: winner.name, winnerCpfNormalized: winner.cpfNormalized };
}

module.exports = {
  drawRaffle
};
