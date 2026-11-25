# ADR 0005 — Use industrial operator display conventions

**Status:** Accepted

**Decision.** Use an original instrument-style interface with a single-line, fixed point tables, chronological events and a local relay faceplate. Use gray for structure and reserve amber and red for stale and trip indications. Always pair those indications with text. Label instructor controls separately. Require explicit confirmation for breaker commands.

**Alternative considered.** A general-purpose dashboard layout would give headline metrics more prominence than the single-line and current device state.

**Consequences.** Keep the diagram and point indications tied to confirmed state. Use the existing in-browser process model while the native protocol adapters are developed. The 3D yard remains a separate task.

References: [Siemens SICAM SCC](https://support.industry.siemens.com/cs/attachments/109756817/scc_b.pdf), [Schneider EcoStruxure Power Operation](https://productinfo.se.com/esxp_digital_apps_iec/edma/English/BM_ESXP_DG_Elec_Distrib_Monitor_Alarm_IEC_0001021838.xml/%24/ESXP_DG_EDMA_SD_Outputs_0001028250), [ABB Relion 615](https://new.abb.com/medium-voltage/Digital-Substations/relion/relion-615-series).
