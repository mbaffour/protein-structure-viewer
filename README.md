# Protein Structure Viewer

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22741487.svg)](https://doi.org/10.5281/zenodo.22741487)
[![Tests](https://github.com/mbaffour/protein-structure-viewer/actions/workflows/tests.yml/badge.svg)](https://github.com/mbaffour/protein-structure-viewer/actions/workflows/tests.yml)

A single-file, browser-based viewer for predicted and experimental protein structures. It is built
for the everyday work around a structure prediction run: look at the models, compare them, check
what the confidence numbers actually say, annotate what matters, and get a figure or a shareable
interactive report out the other end.

Structure files you open stay in the browser. Nothing is uploaded.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/use-cases/confidence-dark.webp">
  <img src="docs/images/use-cases/confidence-light.webp" alt="Protein Structure Viewer showing the AlphaFold model of human p53 coloured by pLDDT, with its predicted aligned error heatmap in the Confidence tab." width="900">
</picture>

- **Live viewer:** <https://mbaffour.github.io/protein-structure-viewer/>
- **Walkthroughs with live examples:** [`docs/USE-CASES.md`](docs/USE-CASES.md)
- **Usage guide:** [`docs/USAGE.md`](docs/USAGE.md)
- **Scientific and publication-readiness audit:** [`SCIENTIFIC-AUDIT.md`](SCIENTIFIC-AUDIT.md)
- **Release notes:** [`CHANGELOG.md`](CHANGELOG.md)
- **Background and design notes:** [blog post](https://mbaffour.github.io/blog/protein-structure-viewer.html)

## Quick start

1. Open the [hosted viewer](https://mbaffour.github.io/protein-structure-viewer/), or open
   `index.html` from a local copy. On macOS you can double-click `Launch Protein Viewer.command`.
2. Drop a `.pdb`, `.cif`/`.mmcif`, or a complete AlphaFold result `.zip` anywhere on the page.
   You can also type an identifier and press **Fetch**:
   - `1ubq` — a PDB entry from RCSB
   - `P69905` — a UniProt accession, resolved against AlphaFold DB
   - `AF-P0DTC2-F1` — an AlphaFold DB entry name
3. Use the tool tabs underneath the viewport: **Models**, **Appearance**, **Annotate**,
   **Compare**, **Confidence**, **Publish**.

Press <kbd>?</kbd> in the viewer for keyboard shortcuts and inline help. The button beside **Help**
switches the interface between **System** (the default: follows your operating system's light or
dark setting, and changes when it does), **Light** and **Dark**.

### What loads

| You drop | What happens |
| --- | --- |
| `.pdb`, `.cif`, `.mmcif` | Loaded as a model |
| AlphaFold result `.zip` | Every model is extracted and grouped under the archive name; template hits are ignored |
| `*_confidences.json`, `*_summary_confidences.json` | pTM, ipTM, ranking score, clash flag, and PAE are attached to matching models |
| `ranking_debug.json`, `ranking_scores.csv` | Ranks and ranking scores are attached to matching models |
| A scene JSON saved from the Publish tab | The whole annotated scene is restored once its structures are present |

Multi-model archives open one model at a time so the browser does not try to render hundreds of
predictions as a single overlay. Large archives load models lazily and skip their very large
`full_data` PAE payloads; those files can still be added individually when you need them.

## Use cases

Seven walkthroughs, each on a structure anyone can load. **Open example** opens the live viewer in
exactly the state pictured; **Walkthrough** gives the steps. Full detail in
[`docs/USE-CASES.md`](docs/USE-CASES.md).

<table>
<tr>
<td width="50%" valign="top">
<a href="docs/USE-CASES.md#1-check-an-alphafold-prediction"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/use-cases/confidence-dark.webp"><img src="docs/images/use-cases/confidence-light.webp" alt="p53 AlphaFold model coloured by pLDDT beside its PAE heatmap." width="100%"></picture></a>
<br><b>1. Check an AlphaFold prediction</b><br>
Which parts can you believe? pLDDT on the model, the PAE heatmap beside it, and a one-click cut that hides low confidence.<br>
<a href="https://mbaffour.github.io/protein-structure-viewer/#scene=z.fVRNb-M2EP0rweylBShDkvVh6-akCHpo0WCz2EMXOdDUSGKXIlWScuIG-e_FULSzdrdrX0TO15s3w_cK_jghNDBZ41Hq5CDxGW3iBGoEBk4MOPLPaJ00GpqMweJwvoF8VVSrNTAQFrnHdufpMs2rJN0mWf0pq5uiatLtaltmf1LGgVtsofF2RkZlD6i5FgjNK3jpFYEhNzNbEb9H9INpl29tPDr6fGMwmhaVg-bLK2g-kvPuPnlIi2pdJ_fZSsgOGHToxXBlAmrDyT0VW3AIo4yFBj5s9qXoKmCg-B4VEVOub37aqWng90a1PwODQbYt6ruBS03Fn96eGDj0XureURfE0O-mJTxO6l4RjxYniw61536hTXDrjdEQS0f_SbWth9jZH7ZFwqQMb7EFBlzJXo-o_Sk7_j0jUfeNaTdNShK_HVcOGXDh5QEpQH2fH4sdWsryAx-u1Ed0sp3xN2LFnbNP1vyFIrY0oXUThnrAwMxeSU0wtQmr1Jn-HBfIffTHMO29eQntKexRtw_GyZhwb7w3Y6KwI05EIPz2-O4Qk3XSPwoTtpgrBeHiI_ZLDmAwxYC72Zuug6Ykj36252Ze32L2OxpFvFhcbmepwhReaU7zSBOHnNDwiXK6BeYQ4HuPFL1s1NLN-citGKRH4WeLEfm5yCccJ8V9eAIf-umQTFyjSi4LBsN-gZP8t_qF-QrKle0C14XtOyCjB75MxvpkjGtqpfanouGQPMvW0zPL6s2lQczOm5EseXpp4WFbyLIqLy3tJKGBdXoV4PGF3M8FIign_yFQ2SZNX7L8PehkFjys2ZlEOfIek87YkVO6SfdXEQtFFwwtV8n0f8sZnEKlZM_p0Z5RLCNOOqOp2M5KrtjNr6gO6KXg7MZx7RKHVnYkaXsuvvbWzFQevOXaTdxiIPvddHcSqy78FknCW1TmGZqUwYAerSGB8FJ8JTGdbcfFN2_Rkf_xUbbvY3ZHLaKuWBNlira48z8QBmFGwvdA-xq0kB7GiJZD8yXJV3m2TYuyyIvNuqrSomRJtsqzsqiKtMzzTV3WRcXqVVqV6zwtN5t8XebbLUvydb2q8jrLNuWmrIttXbM0_LOntygesZpDtehPPI_I3WyRlDDe2EW4fuGeQ6NnpRi0ZjxpNwOudWw3XpxmfKrAD9h-lvi8aP2_">Open example ↗</a> · <a href="docs/USE-CASES.md#1-check-an-alphafold-prediction">Walkthrough</a>
</td>
<td width="50%" valign="top">
<a href="docs/USE-CASES.md#2-compare-a-prediction-with-experiment"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/use-cases/superpose-dark.webp"><img src="docs/images/use-cases/superpose-light.webp" alt="AlphaFold alpha-globin superposed on the 4HHB crystal structure with the alignment table." width="100%"></picture></a>
<br><b>2. Compare a prediction with experiment</b><br>
Superpose, then read Cα pairs, identity and RMSD — AlphaFold's α-globin sits on 4HHB at 0.34 Å over 141 Cα.<br>
<a href="https://mbaffour.github.io/protein-structure-viewer/#scene=z.fVRNb9s4EP0rwfRKCZJsfd5iF0EOXWzQFD1skQNNjSxuKVIlKSfeIP99MZTsxGl2daLm6z3ODN8z-OOI0MBojUepo4PER7SRE6gRGDjR48C_o3XSaGhSBnPA2QJZvC7iFTAQFrnH9tqTMcmKKKmjtPyWls26apIkLqrVX1Sx5xZbaLydkBHsATXXAqF5Bi-9IjIUZiYrlvOAvjftfNbGo6PjC4PBtKgcND-eQfOBgtd9v4uF7IBBh170iwmItpM7Kj7jCqOMhQY-1Wu-2lXAQPEdKoq_vd1cCXt0nitg0Mu2Rb3tudSEBBtgsAUGn-HhhZ1xr2-iu6Kukzy6Sd_hv3X9D48urzHZveFxrcae3xjV_k7i4eWBgUPvpd476hvN5A_TEhNzQKv4ERhYHC061J77eVKCW2-MhgV1SXDeTsJPlqYdGvqnbZEoKcNbJHSu5F4PqP0pA39NSBN747oeRyVfx8qFlwekeHU5FYsdWkr-wMeV-opOthN-oR44aDqu3Lwkf6NYbjGidSOG-sDATF5JTay0CQvbmf05L7Ty3h_DTu3MU7iNwj3q9s44uRTcGe_NECnsPLUmNHlzfA1YinXS3wsT3gpXtBmd9F9xP9cABuOSsJ286TpocorYT_Z8meeXpfqWur8Y5pDNJFVo-jONZhpoypARGz5STTfT7AN975Gy50bPtzn_cit66XGe58z8DPINh1FxHx7ap_14iEauUUWXgMGxm-lEv6NfuN9Reee74HXh-4DkEoFPo7E-GuY9G63U_gQafqJH2Xp6VGlZXTrE5LwZyJMllx4etoU8cX7paUcJDaySdwkenyj8DLCQcvIfIpVWSfKUZq9JJ7fgYc3OTZQD32PUGTtwKjfq_buMuUUXHZpN0fhfyxmCAlK04_RGzyzmEUed0QR2bSVX7OoW1QG9FJxdOa5d5NDKjoRzx8XPvTUTwYO3XLuRWwzNfnVtz9IUvlmGcIPKPEKTMOjRozVBQaT4SZI92Y6LN2_RUfzxXravY3ZHLRYZsWZRJtrizn8gCMIMxOuO9jToHj2IAS2H5keUZnGVpmWW5XlZ1Hm1qliUruMsL-qqqquyXBdpXrJoVcVpUuRFmdRlVaVVmrMqLvJ8XedZUZZFXa5YwpK4LvI6y6usyKo6KfOCJSxK4iyvqrRO1nmaZHmW5Q8vi6wsfByqWZmW_wG5myySJC4WO0vaZ-45NHpSikFrhpOSM-BaL41YDKfpnxD4AdvvEh9n5f8X">Open example ↗</a> · <a href="docs/USE-CASES.md#2-compare-a-prediction-with-experiment">Walkthrough</a>
</td>
</tr>
<tr>
<td valign="top">
<a href="docs/USE-CASES.md#3-explore-a-complex"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/use-cases/complex-dark.webp"><img src="docs/images/use-cases/complex-light.webp" alt="Haemoglobin coloured by subunit with its alpha-beta interface highlighted and the contact map." width="100%"></picture></a>
<br><b>3. Explore a complex</b><br>
Chains, stoichiometry, custom subunit colours, an inter-chain contact map and the ligand pockets.<br>
<a href="https://mbaffour.github.io/protein-structure-viewer/#scene=z.jVVLb9w2EP4rweTSAtRC1GP1uNnOwYcWDZIghwY-cKmRxIYiVZLyo4b_ezCUdu113KK7F3Ge33wzHD5CeJgRWpidDahMcqvwDl3iJRoEBl6OOImv6LyyBlrOYDU4SSDbFftdDgykQxGwuwgkTLN9kjYJr77wqi3qtih2TdX8SRFH4bCDNrgFGaW9RSOMRGgfIaigCQyZ2cXJ7XvCMNpu_TY2oKfPJwaT7VB7aL89ghETGRfjeNhJ1QODHoMcNxEQbK8OFHzNK622Dlp4Xx9K2e-BgRYH1NDCtcDJDtoelHn3S3F9ffkrMBhV16G5GoUylO_m6YaBxxCUGTwBJ1J-tx1B8MoMmqhzODv0aIIIK1NSuGCtgS37Zi8pKGzF_OE6JFjaig47YCC0GsyEJhyj498LElsvVBfzrBVR2gvtkYGQQd0iOehzShz26Mj7DZ3Q-hN61S34GxHhT9FmZ_9CuZUwo_MzxvjAwC5BK0OwjI3T0tvh5Bf5_BweYkMP9j6Wo3FA0320Xm0BDzYEOyUa-0C8RIIvH54NtmC9Cp-ljYMqtIYo-ITDGgMYzJvD1RJs30NbksWwuFMxj09b9CuiPvbsgtqPnHdFDQyu6NQfKl6XwOCSTmlWF7ICBh_olNeHrq9p7NbIl4vSsVmP1M5losGAjIoQM0Hxa3VjrDoEpKTr7K0knI7CyVEFlGFxuBV8SvIFp1mLEC_H-2G-TWZhUCfnCaPisMJJfs5-pn4F5ZXuDNeZ7g2QmwXez9aFZFrnc3bKhGPSeEjuVBfoIvKqPlfIxQc7kSZLzzUiDhlpduW5ppsVtJCnrxwC3pP5KcEGyqt_CBSv0_SeZ89OR7UUcTpPJKpJDJj01k2Cws1meOWxUnTG0CpK5n-b6WgUMyUHQXf7hGJtcdJbQ8kunBKavbtGfYtBScHeeWF84tGpnqbuIOT3wdmF0kNwwvhZOIxkP6uujmutj791c-ElansHbcpgxIDO0h4JSn6nNbu4XsgXV9iT_cNn1T232T8Yua0fZ7dtRlPchzf2iLQT4fpIcxpXJV2ICZ2A9lvC011eNFVepEVRVU2WZizh-S4r91leFmlRN_u8Zkne7Jq8LPf7uiyaJi0LluzTXVrkVVllTV7u9zlL45_fPG2bZsvlUa_Lan0WpjcAxn3bwkVciHHjkW2espyzvGB5yfI942nOeFowntJ3xThPGeeccZ4zzgvGOclqxnnDeJYynmWMZznj2f5m3cBxFEY1jFoNY4AXT04vpOQlPLH_xHf5M758w1dyVpaMpzXjabPByhjnJeN8_wakgvGsZDyrGM9qxnP-vyHe0OMr_OKQHpqN4w3VBxEEtGbRmkFnp-PTyEAYs43JJjjejWOPxC12XxXerU_pDw">Open example ↗</a> · <a href="docs/USE-CASES.md#3-explore-a-complex">Walkthrough</a>
</td>
<td valign="top">
<a href="docs/USE-CASES.md#4-annotate-domains-and-residues"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/use-cases/annotate-dark.webp"><img src="docs/images/use-cases/annotate-light.webp" alt="p53 coloured by five named domains with hotspot residues labelled." width="100%"></picture></a>
<br><b>4. Annotate domains and residues</b><br>
Named domains, residue labels with leader lines, highlights, motifs and your own per-residue data.<br>
<a href="https://mbaffour.github.io/protein-structure-viewer/#scene=z.nVdNj9tIDv0rQc1lFnhuFMn69K3T2WAPu9ggacxhgxzUctmtGVnySnIn2Ub--4CSupPOJgEm9kUqsshXJN8r-95MH0_FbM1p6KfSdJu7prwvw2asS1cMzFjflmP1WxnGpu_MlmAWh8cVwxcuXIiBqYdSTWV3Oemi5bCxeUPxmuLW5a24i-joPxrxthrKzmyn4Vygae9KV3V1Mdt7MzVTq2DUrT8P9fp8LNNtv1ueu34qoz5-gjn2u9KOZvv23nTVUZ0vX25eWRckbl7SRd3sDcy-TPXtVyajxxibG0224Kj7th_M1vySbny9DwamrW5Kq4Xx8uzXy_Z0W73s293fDMxts9uV7uq2ajpN_u7TO5ixTFPTHUY9hVboX_1O8YxNd2i1jkM5DWUs3VRNS9nqapj6vjNr6tW_6rp-0iqa9XT_HnZFcbV9tZtXq7Y5dMfSTQ8Zyn_PRcv3henydGobrfG-ascCU9VTc1d0Q_vtGg1lXwaN8gOfqm1fl7HZncs_tTLjY_TT0P9e6vVYpzKMpzLnMzD9eWqbTmF2_TxO-_7wuG8u8Jvp49zxm_7DfLy2HEq3e9WPzRrwpp-m_rhpy37SWs1Ff_7xs8MabN9Mb-p-nuSqbc288LoclhgG5rRuuDpP_X5vtl49Dufh8TD3n9boV9qOdWFxeX5u2rkL99qr81G7bljRVCeNOS4wb2f401R09zJVy2keX6uhvm2mUk_noazIH5Ncl-OpraaZBr8cTnebU9WVdvM04Wy4WeBs_j_7E_NXUL6yPcH1xPYNkKtH-XDqh2lzXAbvNDTd9JB0ftm8b3aTUo1iemqoz-PUH9XC9qmlmqdFLRf-qWV3aszWiP1qw1Q-qPtjghXU2PxPQVGy9gPx500P5rqax-yxiM2xOpTNvh-OlYY7dYevdiwlelKhZWlz-t5wzk5zps1NpaR9RLG0eLPvO012OTRVi2f_KO1dmZq6wrOx6sbNWIZmr7J2U9V_HIb-rOnNNFTdeKqGMhf7s-nqQbD282eRpfK8tP17s7Uwt2UqQ68CMTX1Hyqo52Ff1V9wcVT_j2-a3ec2jx-7etWVoV-lSqd4P_1AGOr-qPhe6bzOeqjEOJahMtu3G75gytZ5xy5JCNZ5bOiCybvgrGdO0UcXEC9s8MLWp8TiOWdsWOJF4EiUfPLR5Rhh5y-9-7SKxyL9xx9AU0Krada4sTFbih6mWobxSpfXeXpN0ZtP-IvR2KVvR2OXfiJalO9Ei2KWS6ZdhHYt87FU43koKvnryrAo9Itqqsy2O7ctzK4_rhfV4y15ffnCfHHlFaKdS9-AtDvrVfuWwBA4eAREJGSQBRGIQQJyIA8KoAhKoAy2YAIzWMAO7MEBHMEJnCEWQhCGCMRBPCRAIiRBMpyFIziGEzgH5-ECXIRLcBnewhM8wwu8g_fwAT7CJ_iMYBFIy7ReBOtPCHy_C9qitSavXr_-siZ7n4u9-X5NgkPwCAEhIiSEjGgRCZERBdEhesSAGBETYkaySITESILkkDxSQIpICSkjW2RC5p8F_-L5k4ayD1J-AD47ZI8ckCNyQtaGWpAlkGWQFZB1IOtBNoBsBNkEshk0d55A2nttvnZf26_91wHQCaAMYgtiHREGsYDYgdiDOIA4gjiBOIPEgoRAorMkIHEg8SAJIIkgSSDJIGdBjkCOQU6HzoGcB7kAchHkEshlkLcgTyDPIC8gr9PpQT6AfAT5BPIZFCwoECgwKAgoOFDQMQ6gEEEhgUIGRQuKBIoMigKKDiohFHXeIygmUMygZEGJQIlBSUDJgZIHpQBKSowEShmULSgTKDMoCyg7UPagHEA5grIySClkwZbAlsFWwNaBrQfbALYRbBPYZjAp1whMDCYBkwOTB1MAUwRTAisllZMzKRmstFReKjGVmUpN5SZnsFiwEFiUvQIWBxYPlgCWCJYElgx2FuwI7BjslOYO7DzYBbCLUGFkl8Hegj2BPYO9gL3qgQf7APYR7BPYZ3Cw4EDgwOAg4ODAQYUjgEMEhwQOGRwtOBI4MlQuOTpw9OCoChPBMYFjBicLTgRODE4CTg6cPDgFcFIpSuCUwdmCM4F_nnvXf7_-knsUKnHV97kn7CEcIBwhnCAqiaqJKoqzKgpEdVGFUZVRpVG1UTLEWYgjiGOIU_l0EOchLkBchLgEcRniLcQTxDPEC8SrznqIDz97yqvrJwqTRaT86JTBQYJKe4CECAkJEjIkWkgkSGRIFEh0kOghUe-ACIkJEjMkWUgiSGJIEkhykOQhKUCSXhYJkjIkW0gmSGZIlr92und4-L_1-Up9-HG3vo7VXdn91pT3yx-9PwE">Open example ↗</a> · <a href="docs/USE-CASES.md#4-annotate-domains-and-residues">Walkthrough</a>
</td>
</tr>
<tr>
<td valign="top">
<a href="docs/USE-CASES.md#5-build-a-publication-figure"><img src="docs/images/use-cases/figure-multipanel.webp" alt="Three-panel haemoglobin figure exported by the viewer with legends and scale bars." width="100%"></a>
<br><b>5. Build a publication figure</b><br>
Journal presets, print size and dpi, renamed legends, scale bars and multi-panel figures — this image is the exported file.<br>
<a href="https://mbaffour.github.io/protein-structure-viewer/#scene=z.7VbNbtw2EH6VxfjSApSgf2l1s52DDw0axEEODXzgSqNdNhSpkpR_6vidmjxCH8DPVAyl3Y1cN2iBpr1kT-IMOTP85uM3ew_ubkCoYTDaoVDBtcAbNIFtUCEwsM0Oe_4WjRVaQR0zmDYcLJCEWRGmwKAxyB22p46MUVIE0TqIyzdxWedRnaVhkkU_UcQdN9hC7cyIjNJeo-KqQajvwQknqRjapkfTzN89up1up2-lHVr6fGDQ6xalhfrdPSje0-Zst9uEjeiAQYeu2c0moLKt2FDwKW-jpTZQw0m1yZuuAAaSb1BCDRcce72VeiPU6rvs4uLse2CwE22L6nzHhaJ8Vw9XDCw6J9TWUuEEykvdUglWqK0k6AwOBi0qx92EVMON01rBnH3e31BQmC_zo2mRypKat9gCAy7FVvWo3D46_jIiofWZ63QYpCBIOy4tMuCNE9dIB-QSEoMdGjr9jI9L-RqtaEf8gYCwh2iD0T9jM19hQGMH9PGBgR6dFIrKUtqzpdPbwzmP56W78w3d6Ft_HYlbVO0rbcUccKOd030gsXOEiwf47O64YQ7WCXfZaE9ULiV4w2vcTjGAwTAfOB-d7jqoc9qxHc3hMvdT7A97hl2Om1GJQ84Pp1DD48f4sD6j9afj-tz7k8P6hfcnxEJvOKeO-jwU6QTjuM0qYEDnTrpNGVc5MKCoJ1FSZU0JDCjGSVpt2q6iOFPBZ6OQngP3xJKxJ76Bf158oBvaCbSdB9M5pKQTpSdsD0tump1w2LjR4IzjIckb7AfJnX9zJ9vhOhi4QhksE3rHZion-HP2hftJKU98i7oWvmeKnHfg7aCNC_qJ9oMRyu2T-kVwI1pH77sZrdP90jfbaoirdOnhnr7kCfOlpx0EXTyKlmaHt7S9hGVdVvyKPn4U3cbJ8dDe3XBPs2RvFz3fYtBp03MKN6jtkxMTSguQJlMw_NVr8Zt8pmDDSTXiQxlTm4NOK8p2agSXbHWB8hqdaDhbWa5sYNGIjpi34c37rdEj5Ycbagh8bjzfa2Xnf5Mc4hlKfQN1xGCHDo0mcXKieU_aPZqON5_pgqX9d5eiPTbZ3qlm1jSjZ4kkDnfuGXFqdD9wg6-IpV5_6Tn0aDjU74I4CtNsXaZZlGVluU6ihAVxGiZ5kaR5FmXVukgrFqTrcJ3meVFUebZeR3nGgiIKoywt8zJZp3lRpCxiUVhGZRwVZRXHVZFnZf6csbh6mAVumj79MyV7Wa_h1OuuFVBXJQM-0fKcrDOzLoStSpgGipyEdr5ij9yOBkniZ4uZFPoFdxxqNUrJoNX9figx4ErNWM6GPXfmpeXX2L4VeLMYmm_QGULzKDKTGD5-ildctavHj8njp2TVip6e-NeDnkUsvvrC-JpH-Mv91D_6ruaR6gX4YD1OdxI-P1AX7r0m_gvD-wtD8h8_rq_wWLy8n_u2TX9f2KH59HdnNejmPbqn_V8NRt-KnsvVxNFF57MwKfJyffyxIInDvEjoIw3LdVWwPA-TPMmipMzWWVUl35r8PzWZ8qwIgUWLX1MWbFfr6PffvuKz_puK-o0T_wUnrh7-AA">Open example ↗</a> · <a href="docs/USE-CASES.md#5-build-a-publication-figure">Walkthrough</a>
</td>
<td valign="top">
<a href="docs/USE-CASES.md#6-share-your-work"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/use-cases/share-dark.webp"><img src="docs/images/use-cases/share-light.webp" alt="An exported interactive HTML report showing haemoglobin." width="100%"></picture></a>
<br><b>6. Share your work</b><br>
Share links that rebuild the scene, a one-file interactive report for reviewers, and session files.<br>
<a href="https://mbaffour.github.io/protein-structure-viewer/#scene=z.dVVNc9s2EP0rns0lnQE1_JQo3izn4EM7zcSZHJrxAQSXJBIQYAFQtuvxf-8sCMmR69oXAvvx3r5drJ7BP80IDczWeJQ6OUp8QJs4gRqBgRMjTvwbWieNhiZjsDqcbyDflNtNAQyERe6xu_Z0mebbJN0n2e5rtmuqrMnzTV7Uf1HGkVvsoPF2QUawR9RcC4TmGbz0isiQm1msiN8T-tF067c2Hh19vjCYTIfKQfP9GTSfyLkcx3YjZA8MevRijFdAtJ1sKfmKK4wyFhr4ULeV6LfAQPEWFTRwy3EygzKt1Fcfy9vbw2_AYJRdh_pm5FIT3v3LPQOH3ks9OCJOovxhOqLgpB4USWdxtuhQe-5XpQS33hgNET36C0oKsZg_bYdESxneYQcMuJKDnlD7U3b8e0FS6xfT9TwrSZL2XDlkwIWXR6QAdSmJxR4tRb9j40p9QSe7BX8nIdw522zNDxSxhBmtmzHkBwZm8UpqoqVNmJbeDOe4oOedfwoNbc1jKEfhgLr7bJyMCVvjvZkShb0nXYLAh6dXh5isl_5OmDCoXCkIF19wWHMAgzkG3Cze9D00FXkMiz0X8_wSs9-Q9KFn19R-zLKurIHBDZ36dpfVFTA40CnN61LsgMEnOhV12_U1jd2a-bBIFZr1TO1cJhoMyKkIPhMVt1Y3hqq9RwJdZ28V4XzkVozSo_CLxVjwGeQrTrPiPjyOD8N8TGauUSWXgMHQrnSS_6JfmN9QeWO74HVhe4dk9MDH2VifTOt8zlZqfwINh-RBdp4eYrarLw1icd5MZMnTSwsPQ0aWTXVp6WYJDRTpmwCPj-R-BoiknPyHSGV1mj5m-WvQySx4mM6ziHLiAya9sROndLMe3kSsEl0otF4l8__NdHAKSEnL6W2fWawtTnqjCezaSq7Y1S2qI3opOLtyXLvEoZU9TV3Lxc_BmoXgwVuu3cwtBrFfTTentdaHv3Vz4QGVeYAmZTCiR2toj3gpftKaXWzPxS9P2JH_053sXtvsnrSI68eauM1oinv_zh4RZiJen2lOw6qkBzGh5dB8T7J0U5T7XVGmZbnb7fM0Z0lWbPJqmxdVmZb1flvULCn2m31RVdttXZX7fVqVLNmmm7QsdtUu3xfVdluwNPxn9y9x00Qsh2pdVvE8IXeLRVqT8cauW-4T9xwavSjFoDPTabEz4FrHIuPFqbMnBH7E7pvEh_WH4F8">Open example ↗</a> · <a href="docs/USE-CASES.md#6-share-your-work">Walkthrough</a>
</td>
</tr>
<tr>
<td valign="top">
<a href="docs/USE-CASES.md#7-compare-many-models"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/use-cases/ensemble-dark.webp"><img src="docs/images/use-cases/ensemble-light.webp" alt="Four alpha-globin structures superposed and coloured by agreement with the RMSD matrix." width="100%"></picture></a>
<br><b>7. Compare many models</b><br>
Pairwise RMSD matrix, medoid reference and per-residue agreement across four structures of α-globin.<br>
<a href="https://mbaffour.github.io/protein-structure-viewer/#scene=z.lVVNb9s4EP0rwfRKGfqwZFs3J0WQw-42aIoetsiBpkYWtxSpJSkn3iD_vRiKdmy3DbD2hZwPvsfhzNML-P2AUMNgjUepk53EJ7SJE6gRGDjRYc-_onXSaKgzBlPA0QL5bF7NCmAgLHKPzdqTMc2rJF0l2eJLtqjLvJ6Xs6Ja_E0ndtxiA7W3IzKC3aHmWiDUL-ClV0SGwsxoRVz36DvTTGttPDpavjLoTYPKQf3tBTTvKXjedZuZkC0waNGLLpqAaDu5ocMnXGGUsVDDh-WmFG0FDBTfoKL4u7vrqwbN8x4YdLJpUN90XGrCgWtgcAMMPsLjKzuiZrzQF6hkegc1rTZVMz9BzdbFX_8XtevMJWrXmXdQ29WiyE7vmt3dfbr6HeYp1vo2ua9Wq7RMbrMLzFPXO9h5LsoST7DXauj4rVHNz-CPr48MHHov9dZRX1DP_WkaYmJ2aBUnxhYHiw61537qRMGtN4bKHlBjAt9axB61h9gwn2yDREkZ3iChcyW3miJihsN_R6SOPHGth0HJt7blwssdUrw6fwmLLVpKPvhOOpIr9RmdbEb8g2rgoG65ctMQ_IMi3mJA6wYM5wMDM3olNbHSJgxka7bHvFDKB78PM7Mxz-E2Creom3vjZDxwY7w3faKwpRKIUOTr_VtAPKyV_kGYoAUWtzLUsZX-87SuYQ0Mhph0M3rTtlCXFLId7fFCL68R4YZeIBqmkOtRqlD4F3qesaeXhpwY8YHOdBPVLlzBe6TsqdjTjY5bbkUnPQo_WozsjyBfsB8U90FMPmyHXTJwjSo5BwyOzUQn-Rn9zH1B5cJ3xuvM9wuSMQKfB2N90k-9NlgZOnMiS5vkSTY-DPNiee4Qo_OmJ0-ennt46BjyzMpzTzNIqKFILxI8PlP4ESCScvK_oCzLNH3O8rekg1vw0GrHIsqebzFpje05HTfo7UXGVKKzCk2mZPhdg4aggJRsOM3pkcX0xElrNIGtreSKXd2h2qGXgrMrx7VLHFrZ0sdhw8X3rTUjwYO3XLuB20kG3lw3R2kMv0mK8BqVeYI6ZdChR2tIE7wU3-mzNNqWi5N5dBS_f5DN2zO7vRZRSqyJ6kRd3PpfiIIwPfG6pz4N2kcD0aPlUH9LsmK2yJZpUaVZVharLGdkKvJqnq6yIpsv83lZsKRYzlblqliW5bwqVnlRsHJWLfJymVZltVjmi2zB0vDPHl-jbEQsh2pSnrjvkbvRBr2MFjtJ1kfuOdR6VIpBY_qDUjPgWsdLRsPhZQ8IfIfNV4lPk7L_AA">Open example ↗</a> · <a href="docs/USE-CASES.md#7-compare-many-models">Walkthrough</a>
</td>
<td valign="top">
<img src="docs/images/use-cases/anim-recolour.webp" alt="Animation: haemoglobin's four chains recoloured one at a time by subunit." width="100%">
<br><b>In motion</b><br>
Recolouring chains by what they are; the <a href="docs/USE-CASES.md#1-check-an-alphafold-prediction">confidence cut-off</a> and a <a href="docs/USE-CASES.md#2-compare-a-prediction-with-experiment">superposition</a> are animated in the walkthroughs.
</td>
</tr>
</table>

## What it does

**Look at models.** Multiple structures at once with independent visibility, colour, and
ranking-score readout per model. Overlay mode or one-at-a-time mode, with previous/next controls,
arrow-key navigation, adjustable automatic cycling, and sorting by ranking score or mean pLDDT.
Source-archive filtering and name/stoichiometry search keep large prediction sets navigable, a composition table lists each chain of the current model with a show/hide switch, its stoichiometry
by identical sequence, its Cα extent and radius of gyration, and counts its ligands and ions, and the displayed models export as FASTA, one record per chain.
Cartoon, stick, sphere, and line representations, with an optional translucent or opaque molecular
surface; per-structure, per-chain, per-entity (identical sequences share a colour), pLDDT, Cα-deviation, residue-charge, hydrophobicity, residue-type,
amino-acid, secondary-structure, sequence-spectrum, and element colouring; a one-step cut that hides residues below pLDDT 50 or 70
everywhere; ligands and ions as sticks, spheres, or hidden; perspective or orthographic projection;
transparent, white, dark, or custom backgrounds; one-click presets for a thesis figure, a dark slide,
or a confidence review; and exact 90° rotations so panels of the same model line up.

**Read the confidence.** Mean pLDDT from Cα B-factors with the standard AlphaFold legend.
Model-level pTM, ipTM, ranking score, rank, and clash flag, plus chain-pair ipTM and minimum PAE
when the data is there. Interactive PAE heatmaps with per-token inspection that marks the residue pair on the sequence
strip, PNG export, a downloadable confidence-metrics CSV, and a per-residue pLDDT profile figure
(SVG or PNG, one panel per chain, every displayed model overlaid). Interface geometry per model: inter-chain heavy-atom contacts,
interface residues, and Shrake–Rupley buried surface area, with one-click highlighting and CSV export.
PAE-derived domains — groups of residues the prediction places together — as a table, a colour
scheme, and one-click highlights. Ligand sites: contact residues per ligand or ion, site mean pLDDT
and, for AlphaFold 3, ligand–site PAE.

**Compare.** Sequence-aware Cα alignment (global Needleman–Wunsch per chain pair, greedily matched)
or strict chain/residue-ID alignment, with per-model aligned-residue count, sequence identity, chain
mapping, and Cα RMSD, plus a CSV export, a one-click coordinate restore, a colour scheme that
paints each residue by its Cα deviation from the reference, and another that paints the per-residue
Cα RMSF across all aligned models (with a CSV) — where the models of a run agree and where they do not. Synchronized
multi-view of up to six models whose cameras follow each other — rotation only, so assemblies of
different size stay framed, or rotation and zoom for superposed models.

**Annotate.** Map your own per-residue values (conservation, mutational scores, ΔΔG) onto the
structure from a CSV with a gradient legend, and highlight every residue within a distance of a
ligand, a chain, or a clicked residue, or every match of a sequence motif. Click any atom to inspect its model, residue, chain, atom name, and pLDDT, or hover
to read it from the status bar. A sequence strip under the viewer draws every chain coloured by
the current scheme: click a residue to select it, drag a range to fill the selection fields,
double-click to zoom. A sequence-letters panel shows the one-letter sequence with residue numbers,
clickable and copyable per chain.
Type a residue number to go straight to it. Name domains by residue range and colour, apply one
definition to every model of an AlphaFold run, and colour by them with a legend that lists them by
name. Add or edit custom residue labels, or label every residue
in the current model. Highlight or hide chain/residue
ranges, and add atom-to-atom distance or three-atom angle measurements. Draw figure annotations —
arrows, lines, residue markers, text callouts, and corner titles — that follow rotation and alignment
and appear in every export; nudge any label into place and it stays there as the model turns. Give
models display names for captions. Undo and redo every one of these changes.

**Publish.** PNG, TIFF and SVG export at a stated print width and resolution with the dpi written
into the file (or fixed pixel sizes), text sized in points, a journal font, a scale bar, a stitched lettered comparison figure of every
synchronized panel, every saved view as a ZIP of print-size PNGs, SVG variants of both with labels, arrows, captions, and the colour legend
(pLDDT bands, chains, or models) as editable vector layers, and 5-, 10-, or 15-second WebM spin-video export. Reusable named views with
captions, multi-panel contact-sheet export, and caption-text export.
Self-contained interactive HTML reports (each panel with a hover-to-read, click-to-zoom sequence
strip), share links that reopen models fetched by identifier
with the same camera, colours, labels, and annotations, and a figure-legend writer that drafts the
legend from what is on screen. Reproducible scene manifests carrying SHA-256 structure-file
hashes, camera, model state, colours, labels, selections, measurements, saved views, comparison and
alignment settings, and your provenance notes.

## Shareable reports

1. Load the models that should appear in the report.
2. Optionally save named views and captions in the **Publish** tab.
3. Choose whether the report carries the models currently shown or every loaded model, then select
   **Share report**.
4. Open the resulting `protein-model-report.html` in any browser.

The report *is* the figure: it embeds the coordinate data — aligned positions included — and lets a
reader show one to six synchronized panels, pick a model per panel, step every panel forward and
backward, cycle automatically, spin and fit them together, switch the background, follow your saved
guided views and captions, inspect pLDDT and PAE, and export a stitched PNG or composite video of
their own. Labels, measurements, and figure annotations travel with it. It loads 3Dmol.js from a CDN
when opened unless you tick *Embed 3Dmol.js for offline use*, which inlines the integrity-verified
library so the file works with no network. Choose full, compact, or omitted PAE heatmaps to control
the size.

The Publish tab shows the estimated report size before you build it — embedding a few hundred models
produces a file that is slow to open, so narrow the selection when the report is for a reviewer.

## Layout

On a wide screen the viewer is a workspace: the tool tabs scroll in a panel on the left while the
3D view, status and sequence stay pinned on the right, so you see each change as you make it. The
arrows button in the header swaps the sides. Drag the divider to resize the panel; the header's panel button switches to the stacked
layout and back, and the choice is remembered. Screens narrower than 1100 px always stack.

## Colour by MSA

Confidence → *Colour by MSA* reads the unpaired alignment inside an AlphaFold 3 archive (or an
`.a3m` you add) and colours each matching chain by conservation, identity to the query or coverage.
Conservation is 1 − H/log₂20 with the sequences weighted by the position-based scheme of Henikoff &
Henikoff (1994) by default; a switch gives the unweighted column entropy. It loads as a per-residue
dataset, so legend, strip, exports, report and methods text follow and state which weighting was used.

## Composite figure

Publish → *Download composite figure* stitches the 3D view with the PAE heatmap, the pLDDT profile
and the interface contact map into one lettered figure at the chosen print size, each panel rendered
at output resolution with a caption. Tick the panels you want; unavailable ones are greyed out.

## What the report carries

The shared HTML report reproduces the outline, depth cueing and faded chains, and shows the
interface contact map beside the PAE heatmap when one was computed for a model in the report.

## Superposing models

Compare → **Align visible** superposes every shown model onto the reference by Kabsch fitting of
Cα atoms paired by sequence or by residue identifier. For assemblies of identical subunits,
**Match identical chains by position** re-pairs the chains by where they sit after a first fit, so a
model that places the same subunit differently is compared against the copy it corresponds to. In
the Models list, **Emphasise** draws one model solid and the rest as faded thin ribbons, which is
how an overlay of five predictions becomes a figure. **Compute matrix** superposes every shown model
onto every other and tabulates the pairwise Cα RMSDs, exportable as CSV and as a heat map, so an
ensemble figure can say which models agree; it marks the medoid, and **Use medoid as reference**
superposes everything onto that model and emphasises it in one press. **RMSF profile** plots the
per-residue Cα spread across the aligned models, one panel per chain, as SVG or PNG and as a
composite-figure panel. **Fit on** narrows what the rotation is
computed from — a chain, a residue range, or the residues you have selected — and the table reports
the RMSD over that region beside the RMSD over everything matched, which is how a hinge or a moved
domain is shown. Colour by *Cα deviation* to paint what moved, and by *Model agreement* for the
per-residue RMSF across the whole ensemble.

## Moving labels and placing the legend

Labels are draggable: pick one up in the 3D view and put it where the figure needs it. A residue
label keeps a leader line back to its residue and stores its move against the structure, so the
camera can turn without losing the arrangement; *Reset* in its row puts it back. Labels that land on
top of each other — one per model at the same residue of two superposed models — are stacked apart for
you when a position is compared and when a site figure is built, and **Separate labels** does it again
for the framing on screen; a label you moved by hand is left where you put it. An exported figure
works the arrangement out again for each panel, at the size that panel prints its text — print text is
several times larger against the structure than screen text — without moving anything in the view.
**Legend position**
in Publish puts the colour legend in any corner or stacks it down the left or right side of the
figure, on every export and on each panel of a built figure.

## Comparing positions across models

Loaded a wild type and a point mutant from two prediction runs? Select the residue and press
**Compare this position** in Annotate. Every shown model gets the side chain drawn at that position,
a label naming that model's own residue there — `Ala15` against `Gly15`, in the model's colour — and
a one-line readout saying whether the models agree or exactly how they differ. The sticks are part of
the style, so every panel and export shows them, and the labels behave like any other residue label.
Positions are matched by the Cα pairing of the superposition once the models have been aligned, and by
chain and residue number otherwise, so a construct that numbers the same residue differently is still
compared correctly; the methods text says which rule was used.

After **Align visible**, the same press measures what the substitution did to its surroundings: a
neighbourhood table of every residue of the reference model with a heavy atom within the cutoff
(default 5 Å) of the site, each row giving its Cα deviation from the reference in every other model,
with the site first, a neighbourhood mean at the bottom, and a one-line summary — *site moved 0.42 Å
in model_mutant · 7 neighbours within 5 Å moved 0.31 Å on average*. **Highlight neighbourhood** turns
those residues into a normal highlight selection and **Download effect CSV** exports the table.
A site is rarely one residue: type a set into **Positions** — `A:20-30, A:45`, or bare numbers and
ranges for the chain of the selected residue — and **Compare these positions** compares all of them in
one press (up to 40), skipping and counting any that only one shown model carries. The table then opens
with one row per site and follows with the union of their neighbourhoods, each residue counted once,
and the readout becomes one line for the set: *4 positions compared · A:20, A:21, A:24, A:45 · sites
moved 3.10 Å on average in model_3 · 18 neighbours within 5 Å moved 2.40 Å*.

**Make site figure** then turns the comparison into a finished two-panel figure in one press — an
overview of the superposed models with the site marked, and a close-up with the side chains, a label per
model and the wild type solid against the others faded — ticked, lettered and captioned in the figure
builder ready to download as PNG or SVG. With the models superposed it adds a third panel, the same
close-up coloured by Cα deviation from the reference so the reader sees how far each part of the site
moved, with the band scale as its legend; **Deviation panel** turns it off.

## Domain figures

Colour by annotated or PAE domains, then **Label domains** writes each domain's name on the
structure at its centroid in the domain colour, using the names from the legend. **Download
architecture PNG/SVG** draws the linear domain diagram — one row per chain, coloured boxes with
names and boundary residue numbers — which is also a composite-figure panel and an optional row
under the panels of the figure builder, so structure, legend and architecture bar come out of one
set of domain definitions.

## Figure builder

Save a view for each panel you want — an overview, the interface, a zoom — then under
Publish → *Figure builder* tick the views to include, order them, caption them and choose the
columns. **Download figure PNG** or **SVG** renders every panel from its own camera and colour
scheme at the same text size, with its legend and scale bar, and sizes the cells so the whole
figure is the output width you chose. The SVG keeps captions, labels and legends as text. **Save
template** stores the whole presentation — columns, captions, letters, legends, output width,
resolution, text size, format, legend position and scale bar — under a name in your browser, and
**Apply** puts it back on the next figure, so every figure of a paper matches; a template carries no
models, views, camera or colours, so it is safe to apply to another project.

## Publication checklist

The Publish tab lists what a journal or a reviewer would flag about the current figure — pixel
export with no physical size, low resolution, small text, colour-blind-unsafe chain colours, a
missing legend, a scale bar in perspective, unsuperposed models, no title — with one-click fixes.
The badge reads *ready* when nothing remains.

## Interface contact map

Compare → *Interface contact map*: choose two chains, a cutoff and whether any heavy atom or
only Cα counts, and the viewer draws every residue pair within the cutoff as a map, closer pairs
darker. Hover reads the pair, a click selects both residues and zooms to them, *Highlight
interface* colours the interface in 3D, and the map and the pair list download as a 300 dpi PNG
and a CSV. The methods text states the rule and the counts.

## Figure finishing

Appearance offers a silhouette **outline** (thin or bold) and **depth cueing** for figures
that stay legible at column width; both apply everywhere the scene is drawn. The composition
table can **fade** a chain into the background to spotlight the others. Publish has **journal
presets** (Nature, Science, Cell Press, PNAS, PLOS, eLife) that set width, resolution, text
size and font, and **one panel per model**, which renders the models of a run from one camera
into a lettered figure. **Edit labels** on the colour legend renames the legend's title and entries
as they should read on the figure ("N-lobe" for a PAE domain, the protein's name for an entity);
the names apply on screen, on every export and in the generated legend text, change nothing in the
data, and travel with the scene.

## Your work is kept

**Session files.** *Publish → Save session file* writes one ZIP with the models, confidence data,
alignment, annotations, domains, views and settings; *Open session file*, or dropping the ZIP on the
page, restores everything on any computer with no other files. Use it to stop and continue, to move
work between machines, or to hand a colleague the exact state behind a figure.


The open models, annotations, domains, views and settings autosave to the browser's own storage a
moment after every change; reopening the page offers to restore them. Nothing leaves the browser.
Scene JSON, reports and share links remain the way to keep or hand over work deliberately.

## Privacy and network use

Files you open are read by the browser and never leave the machine. The page makes network requests
in exactly two situations:

- On load, to fetch the pinned 3Dmol.js, JSZip, and numeric.js libraries from `cdnjs.cloudflare.com`.
  All three are integrity-pinned with SRI hashes, so a tampered or substituted file will not execute.
- When you use **Fetch** to download a structure by identifier, to `files.rcsb.org` or
  `alphafold.ebi.ac.uk`. That request sends only the identifier you typed.

A Content-Security-Policy header restricts the page to exactly those origins. If the libraries cannot
be reached, the viewer says so rather than failing silently.

If cdnjs cannot be reached, the same three files are requested from jsDelivr under the same integrity
hashes; no other host is ever contacted.

## Scientific-use notes

- pLDDT is a per-residue confidence measure. It does not by itself establish that a multimeric
  interface or the relative placement of chains is correct — read PAE and ipTM for that.
- Alignment is for visual comparison of related models. Sequence-aware mode globally aligns amino-acid
  sequences and reports its chain mapping, identity, aligned Cα count, and RMSD; inspect those values
  before interpreting an overlay, and report them alongside any RMSD you quote.
- Generated reports and exported images are presentation artefacts, not replacements for the original
  coordinate files, confidence JSON, PAE data, or experimental validation.
- Present predictions as predictions, and keep them distinct from experimentally determined structures.

## Validation

Every number the viewer reports is cross-checked against an independent implementation. `tests/reference.py`
computes, with Biopython and numpy, the mean Cα pLDDT, the Kabsch RMSD of each model onto the first,
per-residue Cα RMSF across the superposed models, radius of gyration, exact Cα extent and the residue
set within a cutoff of one chain; `tests/validate.mjs` drives the real viewer on the same files and
compares. On three AlphaFold 3 runs (an M13 virion tip, an MS2 maturation-protein–coat complex and a
phiX174 F–G complex) all 130 comparisons — including the interface contact map, the MSA statistics (weighted and unweighted conservation) and
buried surface area — agree within tolerance (rounding of the reference for distances; 5 % for
buried surface area, which two 92-point Shrake–Rupley samplings cannot match more closely).
[`VALIDATION.md`](VALIDATION.md) has the tables, what is and is not covered, and how to rerun the check on
your own run. The viewer also loads a five-model, 4 410-token assembly with 175 MB of confidence JSON per
model in under eight seconds and a fraction of a gigabyte of memory.

## Hosting it yourself

The application is one self-contained `index.html` with no build step, so any static host works.
For GitHub Pages: repository **Settings → Pages**, deploy from the `main` branch, root folder. The
`.nojekyll` file is already present so the site is served verbatim.

## Development

There is nothing to install, and nothing to build in order to *use* the viewer — open `index.html` and
reload the page. Edits, though, belong in `src/`: see [Building from source](#building-from-source).

A headless regression suite lives in [`tests/`](tests/):

```
cd tests && npm install && npm test
```

It drives the real viewer in Chromium and covers import, navigation, appearance, both alignment modes,
annotation, confidence export, the full publish path, and the generated report. Run it before changing
the alignment or export code. `tests/validate.mjs` cross-checks the analysis numbers on a real run against
`tests/reference.py` (Biopython); see [Validation](#validation).

The file is laid out as: design-system CSS variables and base styles, the viewer markup, viewer-specific
CSS, the main application script, and a small inline icon set and tooltip helper. The application
script is a single IIFE holding all viewer state (`structures`, `labelRecords`, `selectionRecords`,
`measurementRecords`, `savedViews`, `confidenceAssets`) and the functions that render from it.

Third-party libraries are pinned by exact version *and* SRI hash. When bumping one, update the
`integrity` attribute together with the URL — the authoritative hash is available from
`https://api.cdnjs.com/libraries/<name>/<version>?fields=sri` — and confirm that the jsDelivr copy named in
the fallback block still has the same hash, or drop the fallback for that library.

## Publishing a figure

Publish → **Output: Print size** states the width (85 mm single column, 178 mm double column, or
custom), resolution (300 or 600 dpi) and text size in points. **Figure format** then saves it as
PNG or TIFF with the dpi in the file, as a PDF whose page is that physical size, or as JPEG or WebP
for slides; the PNG and TIFF carry the dpi in the file, the SVG keeps text as text in the chosen figure font, and a scale bar can be added. The
**Colour-blind-safe palette** (Okabe–Ito) covers chains and domains, and **Write figure legend**
drafts the legend including the colour bands, cut-offs, alignment statistics, print settings and a
rendering credit. See [`docs/USAGE.md`](docs/USAGE.md#publishing-a-figure) for the checklist.

## Building from source

`index.html` stays the shipped artefact: one self-contained HTML file, committed to the repository, that
needs no build step to open. It is *generated*, though, from the parts in [`src/`](src/), so that work can
happen in files small enough to read:

```
src/00-head.html      doctype, head, styles and markup, up to the main script's `(() => {`
src/js/00-preamble.js the start of the application IIFE
src/js/NN-<name>.js   one file per section of the IIFE, in order
src/99-tail.html      the closing `})();` and everything after it
```

Edits belong in `src/`, never in `index.html` directly. Then regenerate:

```
node scripts/build.mjs
```

The build is a plain concatenation of the parts in lexical order — no dependencies, no transform, no
reformatting — so the generated file is byte-identical to the sum of its sources. Commit `index.html`
along with the `src/` change.

To check that the two have not drifted apart:

```
node scripts/build.mjs --check
```

It exits non-zero and names the first differing line if `index.html` was edited directly or `src/` was
edited without rebuilding. CI runs this check on every change.

`scripts/split.mjs` is the one-off that produced `src/` from `index.html` in the first place. It is kept,
and is idempotent, so the split can be re-derived and audited rather than taken on trust.

## How to cite

Awuah, M. B. (2026). *Protein Structure Viewer* (version 2.10.0) [software].
https://github.com/mbaffour/protein-structure-viewer — each GitHub release is archived on Zenodo
with a DOI; cite the DOI of the release you used (this release: https://doi.org/10.5281/zenodo.22741488; all versions: https://doi.org/10.5281/zenodo.22741487). Metadata for reference managers is in
[`CITATION.cff`](CITATION.cff). Please also cite the rendering library: Rego, N. & Koes, D. (2015).
3Dmol.js: molecular visualization with WebGL. *Bioinformatics* 31(8), 1322–1324.
doi:10.1093/bioinformatics/btu829.

## License

MIT — see [`LICENSE`](LICENSE).

3Dmol.js, JSZip, and numeric.js are loaded at runtime under their own licences. The bundled icon set
is from [Lucide](https://lucide.dev) (ISC).
