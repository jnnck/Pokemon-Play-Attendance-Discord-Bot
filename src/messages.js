// All user-facing strings shown in Discord. Centralised here so they're easy
// to review and translate. Operator-facing logs stay English in their modules.
// Templated strings are exposed as functions so call sites stay declarative.

export const M = {
  // Generic dispatcher fallback (src/index.js)
  genericError: 'Er ging iets mis. Probeer het opnieuw.',

  buttons: {
    register: 'Inschrijven',
    confirm: 'Bevestigen',
    waitlist: 'Op wachtlijst',
    cancel: 'Annuleren',
    unregister: 'Uitschrijven',
    close: 'Sluiten',
  },

  modal: {
    title: 'Eerste inschrijving',
    firstName: 'Voornaam',
    lastName: 'Achternaam',
    playerId: 'Pokémon Player ID',
  },

  // Subscribe / unsubscribe handler replies (src/handlers/stacksSubscribe.js)
  subscribe: {
    eventUnavailable: 'Dit evenement is niet meer beschikbaar.',
    confirmPrompt: (eventName) => `Wil je een plek reserveren voor **${eventName}**?`,
    waitlistPrompt: (eventName) => `**${eventName}** is momenteel vol. Wil je op de wachtlijst?`,
    alreadyOnWaitlist: (eventName) => `Je staat op de wachtlijst voor **${eventName}**.`,
    alreadyRegistered: (eventName) => `Je bent ingeschreven voor **${eventName}**.`,
    unregisterPrompt: (statusSentence) => `${statusSentence} Wil je je uitschrijven?`,
    confirmed: (eventName) => `Je bent ingeschreven voor **${eventName}**. Tot dan!`,
    waitlist: (eventName) => `**${eventName}** is momenteel vol — je staat op de wachtlijst. We laten je weten zodra er een plek vrijkomt.`,
    duplicate: (eventName) => `Je hebt al een actieve inschrijving voor **${eventName}**.`,
    statusFallback: (status) => `Inschrijvingsstatus: ${status}.`,
    profileMissingFull: 'Je spelersprofiel ontbreekt. Klik opnieuw op Inschrijven om je aan te melden.',
    profileMissingShort: 'Je spelersprofiel ontbreekt.',
    cancelled: (eventName) => `Je inschrijving voor **${eventName}** is geannuleerd. Klik opnieuw op Inschrijven als je plannen veranderen.`,
    noActiveReservation: (eventName) => `Je hebt geen actieve inschrijving voor **${eventName}**.`,
    noChanges: 'Geen wijzigingen.',
    playerIdTakenByOther: (playerId) => `Player ID **${playerId}** is gekoppeld aan een ander Discord-account. Neem contact op met een beheerder als dit niet klopt.`,
    accountAlreadyLinked: 'Je account is al gekoppeld. Klik opnieuw op Inschrijven.',
  },

  // Subscribe post embed (built in src/embeds.js, used by stacksEventPoller)
  subscribeEmbed: {
    fieldWhen: 'Wanneer',
    fieldPrice: 'Prijs',
    fieldSpots: 'Plekken',
    spotsValue: (available, max) => `${available} van ${max} beschikbaar`,
    footer: 'Klik hieronder om je plek te reserveren.',
  },

  // Reservation notifier embeds (src/embeds.js → src/tasks/reservationNotifier.js)
  reservationEmbed: {
    newTitle: (eventName) => `Nieuwe inschrijving — ${eventName}`,
    updatedTitle: (eventName) => `Inschrijving bijgewerkt — ${eventName}`,
    fieldPlayer: 'Speler',
    fieldStatus: 'Status',
    fieldSource: 'Bron',
    statusTransition: (oldLabel, newLabel) => `${oldLabel} → ${newLabel}`,
    footer: (id) => `Reservatie #${id}`,
    statusLabels: {
      confirmed: 'Bevestigd',
      waitlist: 'Wachtlijst',
      cancelled: 'Geannuleerd',
      unconfirmed: 'Onbevestigd',
    },
    sourceLabels: {
      discord: 'Discord',
      form: 'Webformulier',
      manual: 'Handmatig (beheerder)',
    },
  },

  // Leaderboard embed (src/embeds.js)
  leaderboardEmbed: {
    title: 'Top 10 meest actieve spelers (altijd)',
    empty: 'Nog geen data.',
    line: (prefix, name, count) =>
      `${prefix} ${name} — ${count} ${count === 1 ? 'evenement' : 'evenementen'}`,
  },

  // Standings embeds (src/embeds.js, used by /upload)
  standingsEmbed: {
    title: (tournamentName) => `Resultaten — ${tournamentName}`,
    didNotFinish: '*Niet beëindigd:*',
    noResults: '*Geen resultaten*',
  },

  // Slash commands
  commands: {
    attendance: {
      description: 'Bekijk de aanwezigheidsgeschiedenis van jezelf of een andere speler',
      userOptionDescription: 'Discord-gebruiker om te bekijken (laat leeg voor jezelf)',
      notRegisteredSelf: 'Je hebt je Player ID nog niet gekoppeld. Gebruik `/register` om je account te koppelen.',
      notRegisteredOther: (userId) => `<@${userId}> heeft zijn Player ID nog niet gekoppeld.`,
      roleStatusLine: (statusEmoji, count, totalMonths, qualifies) => {
        const monthsWord = totalMonths === 1 ? 'maand' : 'maanden';
        const tail = qualifies
          ? ' — heeft de aanwezigheidsrol'
          : ' — komt niet in aanmerking voor de aanwezigheidsrol';
        return `${statusEmoji} Aanwezig in **${count}/${totalMonths}** recente ${monthsWord}${tail}`;
      },
      noHistory: 'Geen toernooi-aanwezigheid geregistreerd.',
      embedTitle: (username) => `Aanwezigheid: ${username}`,
      fieldPlayerId: 'Player ID',
      fieldTotalEvents: 'Totaal aantal evenementen',
      fieldRoleStatus: 'Status aanwezigheidsrol',
      fieldRecentHistory: 'Recente geschiedenis (laatste 10)',
    },
    eventsClear: {
      description: 'Wis alle opgeslagen evenementen',
      cleared: (count) =>
        `**${count}** evenement${count === 1 ? '' : 'en'} gewist. Nieuwe evenementen worden bij de volgende poll opgehaald.`,
    },
    events: {
      description: 'Toon aankomende Pokémon TCG-evenementen in de buurt',
      noUpcoming: 'Geen aankomende evenementen gevonden.',
      line: (date, time, title, store, link) =>
        `**${date}${time}** — ${title}${store ? ` @ ${store}` : ''}${link}`,
      embedTitle: 'Aankomende evenementen',
      footer: (count) => `${count} evenement${count === 1 ? '' : 'en'} gevonden`,
    },
    leaderboard: {
      description: 'Toon de top 10 meest actieve spelers ooit',
      noData: 'Nog geen toernooidata. Upload eerst een TDF-bestand.',
    },
    register: {
      description: 'Koppel je Discord-account aan je Pokémon TCG Player ID',
      playerIdOptionDescription: 'Je Player ID zoals die in TDF-toernooibestanden staat',
      playerIdTaken: (playerId) =>
        `Player ID **${playerId}** is al gekoppeld aan een ander Discord-account.`,
      noTournaments: 'Er zijn nog geen toernooien geüpload.',
      statusLine: (count, totalMonths, qualifies, REQUIRED, WINDOW) => {
        const monthsWord = totalMonths === 1 ? 'maand' : 'maanden';
        const tail = qualifies
          ? ' — je hebt de aanwezigheidsrol!'
          : ` — je hebt minstens 1 evenement nodig in ${REQUIRED} van de laatste ${WINDOW} maanden om de aanwezigheidsrol te krijgen.`;
        return `Je was aanwezig in **${count}** van de laatste **${totalMonths}** ${monthsWord}${tail}`;
      },
      updated: (oldId, newId) =>
        `Je registratie is bijgewerkt van **${oldId}** naar **${newId}**.`,
      registered: (playerId) =>
        `Player ID **${playerId}** gekoppeld aan je account.`,
      hint: 'Je Player ID vind je in officiële toernooi-exports.',
    },
    tournamentDelete: {
      description: 'Verwijder een geregistreerd toernooi en de bijbehorende aanwezigheidsdata',
      idOptionDescription: 'Toernooi-ID (gebruik /tournaments om het op te zoeken)',
      notFound: (id) => `Geen toernooi gevonden met ID \`#${id}\`.`,
      embedTitle: 'Toernooi verwijderd',
      fieldTournament: 'Toernooi',
      fieldDate: 'Datum',
      fieldPlayersRemoved: 'Spelers verwijderd',
      footer: 'Aanwezigheidsrollen zijn opnieuw gesynchroniseerd.',
    },
    tournaments: {
      description: 'Lijst alle geregistreerde toernooien op',
      noTournaments: 'Er zijn nog geen toernooien geüpload.',
      line: (id, name, date, playerCount) =>
        `\`#${id}\` **${name}** — ${date} (${playerCount} spelers)`,
      embedTitle: 'Geregistreerde toernooien',
      footer: (count) =>
        `${count} toernooi${count === 1 ? '' : 'en'} in totaal`,
    },
    upload: {
      description: 'Upload een TDF-bestand om toernooi-resultaten te registreren',
      fileOptionDescription: 'Het .tdf-bestand uit Tournament Manager',
      wrongFileType: 'Upload een `.tdf`-bestand.',
      downloadFailed: (msg) => `Bestand downloaden mislukt: ${msg}`,
      parseFailed: (msg) => `TDF-bestand kon niet verwerkt worden: ${msg}`,
      embedTitle: 'Toernooi geüpload',
      fieldTournament: 'Toernooi',
      fieldDate: 'Datum',
      fieldPlayersRecorded: 'Spelers geregistreerd',
      fieldRoleGranted: (n) => `Rol toegekend (${n})`,
      fieldRoleRemoved: (n) => `Rol verwijderd (${n})`,
    },
  },

  // Pokedata event embed + Discord scheduled event description (src/tasks/eventFetcher.js)
  pokedataEmbed: {
    fallbackTitle: 'Pokémon Event',
    fieldDate: 'Datum',
    fieldTime: 'Tijd',
    fieldType: 'Type',
    fieldStore: 'Winkel',
    fieldLocation: 'Locatie',
    timeTBD: 'Onbekend',
    locationTBD: 'Onbekend',
    eventTypeLine: (type) => `Type: ${type}`,
    eventDetailsLine: (link) => `Details: ${link}`,
  },
};

export function statusLabel(status) {
  return M.reservationEmbed.statusLabels[status] ?? status;
}

export function sourceLabel(source) {
  return M.reservationEmbed.sourceLabels[source] ?? source;
}
