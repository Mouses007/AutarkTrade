/**
 * Share-Karten (FLUX.2 + Gemini) — Modul-Singleton.
 *
 * Geteilt zwischen KI → Bilder (die Einstellungen selbst) und KI → Allgemein
 * (zeigt, ob ein Bild-Schlüssel hinterlegt ist). Geladen beim Öffnen des
 * KI-Bereichs (`loadFluxSettings` in EinstellungenKi.vue).
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { bildModellListen, bildStandardListen } from './useKiAnbieter.js'

export let shareCardProvider = ref('flux')
export let fluxApiKey = ref('')
export let fluxModel = ref('flux-2-pro')
export let fluxDisplayName = ref('')
export let fluxAvatar = ref('')
export let fluxUseCustomAvatar = ref(false)
export let fluxTestLoading = ref(false)
export let fluxTestResult = ref(null)
export let geminiImageApiKey = ref('')
export let geminiImageModel = ref('gemini-3.1-flash-image')
export let geminiTestLoading = ref(false)
export let geminiTestResult = ref(null)

// Prompt-Vorlagen der Share-Karten — Anlegen/Anwenden/Löschen gab es schon im
// Trade-Modal (ShareCardModal.vue); hier kommt die Verwaltung dazu (Umbenennen
// und Löschen), zentral in den Einstellungen statt nur pro Trade. Der
// Prompt-Text ist bewusst NICHT bearbeitbar — er hat mit dem gespeicherten
// Bild nichts zu tun (keine Bild-Bearbeitung in der App), ein frei
// eintragbares Feld hätte das fälschlich suggeriert.
export let shareCardTemplates = ref([])
export let templatesLoading = ref(false)
export let editingTemplateId = ref(null)
export let editTemplateName = ref('')
export let savingTemplateEdit = ref(false)
export let deletingTemplateId = ref(null)

// Bekannte Preis-Hinweise je Modellname — nur Kosmetik. Ein über „Modelle
// verwalten" (ModelManager.vue) neu hinzugefügtes Modell (z.B. eine künftige
// „flux-3-…"-Reihe) hat keinen Eintrag hier und zeigt dann einfach seinen
// rohen Namen — das Dropdown selbst kommt serverseitig aus derselben
// DB-gestützten Liste wie bei den Chat-Anbietern (`modellListen`), nicht mehr
// aus einer im Code fest verdrahteten Auswahl.
export const FLUX_PREISHINWEIS = {
    'flux-2-pro': 'FLUX.2 Pro (~$0.03)',
    'flux-2-flex': 'FLUX.2 Flex (~$0.05)',
    'flux-2-max': 'FLUX.2 Max (~$0.07)',
    'flux-3-image': 'FLUX.3 (neu, Okt. 2026)',
}
export const GEMINI_BILD_NAME = {
    'gemini-nano-banana-2.1': 'Nano Banana 2.1 (~$0.034)',
    'gemini-3.1-flash-lite-image': 'Nano Banana 2 Lite (Gemini 3.1 Flash Lite)',
    'gemini-3.1-flash-image': 'Nano Banana 2 (Gemini 3.1 Flash)',
    'gemini-3-pro-image': 'Nano Banana Pro (Gemini 3 Pro)',
}

export function useShareCard() {
    const { t } = useI18n()

    // Die Ausgangslisten kommen vom Server (`bildStandard` in der
    // `/api/ai/models`-Antwort, aus derselben `BILD_MODELL_REG`-Registry, aus der
    // server/ai-models.js auch die eigentliche Modell-Liste ableitet) — keine
    // zweite, hier von Hand gepflegte Kopie, die bei einer Änderung der Registry
    // unbemerkt zurückbleibt.
    const fluxModels = computed(() => {
        const liste = bildModellListen.value.flux?.length ? bildModellListen.value.flux : (bildStandardListen.value.flux || [])
        return liste.map((m) => ({ value: m, label: FLUX_PREISHINWEIS[m] || m }))
    })

    const geminiImageModels = computed(() => {
        const liste = bildModellListen.value.geminiBild?.length ? bildModellListen.value.geminiBild : (bildStandardListen.value.geminiBild || [])
        return liste.map((m) => ({ value: m, label: GEMINI_BILD_NAME[m] || m }))
    })

    /**
     * Gespeicherten Namen auf einen Eintrag der Auswahl bringen.
     *
     * Die Vorschau-Namen sind inzwischen allgemein verfügbar (ohne `-preview`), und
     * das alte `gemini-2.0-flash-preview-image-generation` gibt es bei Google gar
     * nicht mehr. Ohne Abgleich stünde das Feld leer da, obwohl in der Datenbank
     * etwas hinterlegt ist.
     */
    function gueltigesBildmodell(m) {
        const s = String(m || '').replace(/-preview$/, '')
        return geminiImageModels.value.some((e) => e.value === s) ? s : 'gemini-3.1-flash-image'
    }

    /**
     * Dasselbe für FLUX: ein alter oder nie gültiger Modellname (die Datenbank
     * trug hier lange den Platzhalter `flux-2-klein-9b`) liesse das Dropdown ohne
     * Auswahl stehen, weil `<select v-model>` keine passende `<option>` findet.
     */
    function gueltigesFluxModell(m) {
        const s = String(m || '')
        return fluxModels.value.some((e) => e.value === s) ? s : 'flux-2-pro'
    }

    /** Nach dem Bearbeiten der Bild-Modell-Liste (ModelManager.vue): Auswahl gültig halten. */
    function fluxModelleGeaendert(liste) {
        bildModellListen.value = { ...bildModellListen.value, flux: liste }
        if (!liste.includes(fluxModel.value)) fluxModel.value = liste[0] || 'flux-2-pro'
    }
    function geminiBildModelleGeaendert(liste) {
        bildModellListen.value = { ...bildModellListen.value, geminiBild: liste }
        if (!liste.includes(geminiImageModel.value)) geminiImageModel.value = liste[0] || 'gemini-3.1-flash-image'
    }

    async function loadFluxSettings() {
        try {
            const res = await axios.get('/api/flux/settings')
            shareCardProvider.value = res.data.shareCardProvider || 'flux'
            fluxApiKey.value = res.data.fluxApiKey || ''
            fluxModel.value = gueltigesFluxModell(res.data.fluxModel)
            fluxDisplayName.value = res.data.fluxDisplayName || ''
            fluxAvatar.value = res.data.fluxAvatar || ''
            fluxUseCustomAvatar.value = !!res.data.fluxUseCustomAvatar
            geminiImageApiKey.value = res.data.geminiImageApiKey || ''
            geminiImageModel.value = gueltigesBildmodell(res.data.geminiImageModel)
        } catch (e) {
            console.error('Fehler beim Laden der Share-Card-Settings:', e)
        }
        await loadShareCardTemplates()
    }

    async function loadShareCardTemplates() {
        templatesLoading.value = true
        try {
            const res = await axios.get('/api/db/share_card_templates', { params: { sort: '-createdAt' } })
            shareCardTemplates.value = (res.data.results || res.data || []).map((r) => ({
                id: r.objectId || r.id,
                name: r.name,
                category: r.category || '',
                imageBase64: r.imageBase64 || '',
            }))
        } catch (e) {
            console.error('Fehler beim Laden der Share-Card-Vorlagen:', e)
            shareCardTemplates.value = []
        }
        templatesLoading.value = false
    }

    function startEditTemplate(tpl) {
        editingTemplateId.value = tpl.id
        editTemplateName.value = tpl.name
    }

    function cancelEditTemplate() {
        editingTemplateId.value = null
        editTemplateName.value = ''
    }

    async function saveTemplateEdit() {
        if (!editTemplateName.value.trim()) return
        savingTemplateEdit.value = true
        try {
            await axios.put(`/api/db/share_card_templates/${editingTemplateId.value}`, {
                name: editTemplateName.value.trim(),
            })
            cancelEditTemplate()
            await loadShareCardTemplates()
        } catch (e) {
            alert(t('common.errorSaving') + e.message)
        }
        savingTemplateEdit.value = false
    }

    async function deleteShareCardTemplate(id) {
        if (!confirm(t('settings.shareCardTemplateDeleteConfirm'))) return
        deletingTemplateId.value = id
        try {
            await axios.delete(`/api/db/share_card_templates/${id}`)
            if (editingTemplateId.value === id) cancelEditTemplate()
            await loadShareCardTemplates()
        } catch (e) {
            alert(t('common.errorSaving') + e.message)
        }
        deletingTemplateId.value = null
    }

    async function saveFluxSettings() {
        try {
            await axios.post('/api/flux/settings', {
                shareCardProvider: shareCardProvider.value,
                fluxApiKey: fluxApiKey.value,
                fluxModel: fluxModel.value,
                fluxDisplayName: fluxDisplayName.value,
                fluxAvatar: fluxAvatar.value,
                fluxUseCustomAvatar: fluxUseCustomAvatar.value,
                geminiImageApiKey: geminiImageApiKey.value,
                geminiImageModel: geminiImageModel.value
            })
            fluxTestResult.value = { success: true, message: t('common.saved') }
            setTimeout(() => fluxTestResult.value = null, 3000)
            await loadFluxSettings()
        } catch (e) {
            alert(t('common.errorSaving') + e.message)
        }
    }

    async function testFluxConnection() {
        fluxTestLoading.value = true
        fluxTestResult.value = null
        try {
            const res = await axios.post('/api/flux/test', { fluxApiKey: fluxApiKey.value })
            fluxTestResult.value = res.data
        } catch (e) {
            fluxTestResult.value = { success: false, message: e.message }
        }
        fluxTestLoading.value = false
    }

    async function testGeminiConnection() {
        geminiTestLoading.value = true
        geminiTestResult.value = null
        try {
            const res = await axios.post('/api/flux/test-gemini', { geminiImageApiKey: geminiImageApiKey.value })
            geminiTestResult.value = res.data
        } catch (e) {
            geminiTestResult.value = { success: false, message: e.message }
        }
        geminiTestLoading.value = false
    }

    function onFluxAvatarUpload(event) {
        const file = event.target.files[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (e) => {
            fluxAvatar.value = e.target.result
        }
        reader.readAsDataURL(file)
    }

    return {
        shareCardProvider, fluxApiKey, fluxModel, fluxDisplayName, fluxAvatar, fluxUseCustomAvatar,
        fluxTestLoading, fluxTestResult, geminiImageApiKey, geminiImageModel, geminiTestLoading, geminiTestResult,
        shareCardTemplates, templatesLoading, editingTemplateId, editTemplateName, savingTemplateEdit, deletingTemplateId,
        fluxModels, geminiImageModels, gueltigesBildmodell, gueltigesFluxModell, fluxModelleGeaendert,
        geminiBildModelleGeaendert, loadFluxSettings, loadShareCardTemplates, startEditTemplate, cancelEditTemplate,
        saveTemplateEdit, deleteShareCardTemplate, saveFluxSettings, testFluxConnection, testGeminiConnection,
        onFluxAvatarUpload,
    }
}
