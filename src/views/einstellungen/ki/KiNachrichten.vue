<script setup>
/**
 * KI → Nachrichten: der Lagebericht. Zweigeteilt, weil der Abschnitt allein
 * über 700 Zeilen Markup hat — Quellen, Profile und Rhythmus in
 * KiNewsQuellen.vue, Versand, Inhalt und Modelle in KiNewsBericht.vue. Beide
 * schreiben über `radarSpeichern` in dieselben Felder (useRadarEinstellungen).
 */
import { useI18n } from 'vue-i18n'
import { currentUser } from '@/stores/settings.js'
import { radarNewsBerichtProvider, radarNewsBerichtModell } from '../gemeinsam/useRadarEinstellungen.js'
import KiNewsQuellen from './KiNewsQuellen.vue'
import KiNewsBericht from './KiNewsBericht.vue'

const { t } = useI18n()
</script>

<template>
    <div>
        <p class="fw-lighter">{{ t('settings.ki.nachrichtenHint') }}</p>
        <!--=============== LAGEBERICHT ===============-->
        <hr class="mt-4" />
        <p class="fw-bold mb-1">{{ t('settings.ki.news.title') }}</p>
        <p class="fw-lighter">{{ t('settings.ki.news.intro1') }}</p>
        <p class="fw-lighter">
            {{ t('settings.ki.news.intro2') }}
            <code>{{ radarNewsBerichtProvider || currentUser?.aiProvider || '—' }} / {{ radarNewsBerichtModell || currentUser?.aiModel || '—' }}</code>
            {{ t('settings.ki.news.intro2b') }}
        </p>
        <p class="fw-lighter">{{ t('settings.ki.news.intro3') }}</p>

        <KiNewsQuellen />

        <KiNewsBericht />
    </div>
</template>
