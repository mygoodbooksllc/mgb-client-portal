# Proposed client roster for the Asana import (owner review)

Built 2026-10-16 by `scripts/asana-import/buildDryRun.js` from the Asana snapshot of 2026-10-16T17:00:00Z and the firm QuickBooks customer list (`qbo_customer_client_map`). **Proposal only: no client rows were created.** Approve, edit or strike entries; the client rows are then made with the normal client tools, and the import maps Asana projects to them by name and the aliases below.

Where the list could come from (checked 2026-10-16): QuickBooks customers (141 records, about 75 active) is the only complete source. The portal `clients` table holds only the MGB row and two test clients; `qbo_connections` holds only MGB and a sandbox; the client Google Drive has one test folder; Asana teams name the bookkeeper for 30 of the projects.

**Columns:** proposed id (the portal client id), QuickBooks match (`high` exact name, `medium` all words of the shorter name, `acronym` e.g. MBTR+V, `first word` only the first word matches (check it), `ambiguous` more than one candidate: owner picks), bookkeeper from the Asana team (Naomi's Clients -> Sonya per owner decision 2).

## All Team (14)

This Asana team does not name a bookkeeper, so these clients have none yet either; same handling as No team yet.

| Proposed id | Client name | Asana projects | QuickBooks | Match | Bookkeeper |
|---|---|---|---|---|---|
| ascension-of-anglican | Ascension of Anglican | Ascension of Anglican | - | none | - |
| careerspring | CareerSpring | CareerSpring | CareerSpring (#113) | high | - |
| city-church-of-lancaster | CITY CHURCH OF LANCASTER | City Church of Lancaster | CITY CHURCH OF LANCASTER (#314) | high | - |
| citymark-church | Citymark Church | Citymark Church | Citymark Church (#110) | high | - |
| e320-cadency | E320 (Cadency) | E320 (Cadency) | E320 Ministries Inc (#245) | first word | - |
| eternal-rock-church | Eternal Rock Church | Eternal Rock | Eternal Rock Church (#106) | high | - |
| fade | Fade | Fade | Fade Group LLC (#185) | first word | - |
| fervent-church | Fervent Church | Fervent Church | Fervent Church (#290) | high | - |
| glory-church | Glory Church | Glory Church | Glory Church (#387) | high | - |
| grace-reformed-baptist-church | Grace Reformed Baptist Church | Grace Reformed Baptist | Grace Reformed Baptist Church (#393) | high | - |
| manna-church-clarksville | Manna Church- Clarksville | Manna Church - Clarksville | Manna Church- Clarksville (#390) | high | - |
| new-circle-church | New Circle Church | New Circle Church | New Circle Church (#330) | high | - |
| space-city-church | Space City Church | Space City | Space City Church (#342) | high | - |
| the-plant-california-initiative | The Plant California Initiative | The Plant California Initiative | The Plant California Initiative (#255) | high | - |

## Debra's Clients (6)

| Proposed id | Client name | Asana projects | QuickBooks | Match | Bookkeeper |
|---|---|---|---|---|---|
| 99-network | 99 Network | 99 Network | 99 Network (#280) | high | Debra |
| church-at-the-shores | Church at the Shores | Church at the Shores | Church at the Shores (#275) | high | Debra |
| faith-family-church-baytown | Faith Family Church - Baytown | Faith Family Church | Faith Family Church - Baytown (#55) | medium | Debra |
| hosanna-church | Hosanna Church | Hosanna Church | Hosanna LA #323 or Hosanna Woodlands #40 | ambiguous | Debra |
| pathway-community-church | Pathway Community Church | Pathway Church | Pathway Community Church (#132) | medium | Debra |
| vida-church | Vida Church | Vida Church | Vida Church (#208) | high | Debra |

## Gillian's Clients (8)

| Proposed id | Client name | Asana projects | QuickBooks | Match | Bookkeeper |
|---|---|---|---|---|---|
| believing-church | Believing Church | Believing Church | Believing Church (#50) | high | Gillian |
| city-house-church | City House Church | City House Church | City House Church (#114, inactive) | high | Gillian |
| compassion-church | Compassion Church | Compassion Church | Compassion Church (#236, inactive) | high | Gillian |
| grace-city-church | Grace City Church | Grace City Church | Grace City Church (#71) | high | Gillian |
| hilltop-church | Hilltop Church | Hilltop Church | Hilltop Church (#35) | high | Gillian |
| limitless-church | Limitless Church | Limitless Church | Limitless Church (#143) | high | Gillian |
| voice-church-oc | Voice Church OC | Voice Church | Voice Church OC (#21) | medium | Gillian |
| zeal-church | Zeal Church | Zeal Church | Zeal City Church (#270) | first word | Gillian |

## Illumination Health and Home (1)

This Asana team does not name a bookkeeper, so these clients have none yet either; same handling as No team yet.

| Proposed id | Client name | Asana projects | QuickBooks | Match | Bookkeeper |
|---|---|---|---|---|---|
| illumination-health-home | Illumination Health + Home | Illumination | Illumination Health + Home (#126) | medium | - |

## Naomi's Clients (1)

| Proposed id | Client name | Asana projects | QuickBooks | Match | Bookkeeper |
|---|---|---|---|---|---|
| good-land-church | Good Land Church | Good Land Church | Good Land Church (#176) | high | Sonya |

## Nicole's Clients (11)

| Proposed id | Client name | Asana projects | QuickBooks | Match | Bookkeeper |
|---|---|---|---|---|---|
| cistern-church | Cistern Church | Cistern Church | Cistern Church (#29) | high | Nicole |
| city-church-lufkin | City Church Lufkin | City Church-Lufkin | City Church Lufkin (#49) | high | Nicole |
| creative-academy | Creative Academy | Creative Academy | Creative Academy (#324) | high | Nicole |
| crossings-community-church | Crossings Community Church | Crossings Church | Crossings Community Church (#111) | medium | Nicole |
| gabriel-photography | Gabriel Photography | Gabriel Photography | Gabriel Photography (#62) | high | Nicole |
| highpoint-church | Highpoint Church | Highpoint Church | Highpoint Church (#25) | high | Nicole |
| life-west | Life West | Life West Church | Life West (#48) | high | Nicole |
| manna-church | Manna Church | Manna Church | Manna Church (#293) | high | Nicole |
| manna-retreat-center | Manna Retreat Center | Manna Retreat Center | Manna Retreat Center (#332) | high | Nicole |
| renaissance-church | Renaissance Church | Renaissance Church | Renaissance Church (#39) | high | Nicole |
| vivid-church | Vivid Church | Vivid Church | Vivid Church (#211) | high | Nicole |

## Sonya's Clients (3)

| Proposed id | Client name | Asana projects | QuickBooks | Match | Bookkeeper |
|---|---|---|---|---|---|
| ascent-church | Ascent Church | Ascent | Ascent Church (#51) | high | Sonya |
| creative-church | Creative Church | Creative Church | Creative Church (#268) | high | Sonya |
| life-church | Life Church | Life Church | Life Church Danville (#74) | first word | Sonya |

## No team yet (16)

No Asana team, so no bookkeeper. They import onto their client with the fallback as row owner and keep their Asana assignees; an admin gives each a bookkeeper later (`tk_import_assign_team`, UI planned: Tasks sidebar No team yet group).

| Proposed id | Client name | Asana projects | QuickBooks | Match | Bookkeeper |
|---|---|---|---|---|---|
| christ-church-murrells-inlet | Christ Church Murrells Inlet | Christ Church Onboarding [onboarding]; Christ Church | Christ Church Murrells Inlet (#439) | medium | - |
| collective-church | Collective Church | Collective Church Onboarding [onboarding]; Collective Church Onboarding [onboarding] | Collective Church (#100000001) | high | - |
| doxa-church | Doxa Church | Doxa Church Onboarding [onboarding]; Doxa Church | Doxa Church (#417) | high | - |
| dreamraise | Dreamraise | Dreamraise Onboarding [onboarding]; Dreamraise | Dreamraise (#413) | high | - |
| fresh-start-network | Fresh Start Network | Fresh Start Onboarding [onboarding] | Fresh Start Network (#438) | medium | - |
| golden-city-church | Golden City Church | Golden City Church Onboarding [onboarding]; Golden City; Golden City Church Onboarding [onboarding] [archived] | Golden City Church (#419) | high | - |
| happy-horizons-childrens-ranch | Happy Horizons Children's Ranch | HHCR | Happy Horizons Children's Ranch (#376) | acronym | - |
| life-on-mission-church-inc | Life on Mission Church, Inc. | Life on Mission Church | Life on Mission Church, Inc. (#398) | high | - |
| lifot-faith | Lifot Faith | Lifot | Lifot Faith (#348) | medium | - |
| myrtle-beach-therapeutic-riding-vaulting-club | Myrtle Beach Therapeutic Riding + Vaulting Club | MBTR+V Club; MBTR+V Club [archived] | Myrtle Beach Therapeutic Riding + Vaulting Club (#411) | acronym | - |
| p23-church | P23 Church | P23 Onboarding [onboarding]; P23 Church; P23 [tracker] | P23 Church (#410) | high | - |
| pink-parcels-llc | Pink Parcels LLC | Pink Parcels | Pink Parcels LLC (#352) | high | - |
| tampa-design-company | Tampa Design Company | Tampa Design | Tampa Design Company (#291) | high | - |
| the-way | The Way Bookkeeping | The Way Church Onboarding [onboarding]; The Way Bookkeeping | The Way Community Church (#418) | first word | - |
| tree-city-church | Tree City Church | Tree City Church | Tree City Church (#347) | high | - |
| unco-church | UNCO Church | UNCO Church | UNCO Church (#349) | high | - |

## Active in QuickBooks, no Asana project (22)

Possibly clients with no open Asana work, billing-only customers or old records. Owner: add any that should be portal clients.

| QuickBooks customer | # | Last invoice |
|---|---|---|
| 3Circle Church | 207 | - |
| 3D Property Solutions | 353 | - |
| Carolina Forest Anglican Mission | 397 | - |
| Central Church Orange Beach | 436 | - |
| City House Church, Milwaukee | 115 | - |
| Commissioned City Church | 344 | - |
| Compassion Church AZ | 237 | - |
| Copeland Magic LLC | 38 | - |
| Faith Baptist Church | 271 | - |
| Ginger Harris LLC | 296 | - |
| HHCR Foundation | 394 | 2026-09-01 |
| Jonathan Brozozog Ministries | 318 | 2026-10-01 |
| LIFEHOUSE NEWPORT NEWS | 32 | 2026-10-06 |
| Mator Therapy Services | 338 | - |
| Meals On Wheels of Horry County | 415 | 2026-10-01 |
| Miles & Associates LLC | 372 | - |
| Novo | 298 | - |
| The Get Together | 217 | - |
| Travelers Business Insurance | 420 | - |

Plus 3 customer(s) named like a person, not listed here (see the scratchpad roster-full.md).
