"""make_data.py — build the JSON data files for the GSI Datasets site.

Reads the source XLSX files from /Projects/GSI/data/Website/ and writes
lean JSON to ./data/. Run after any update to the source files.

  $ python3 make_data.py
"""
from pathlib import Path
import json
import re
import shutil
from datetime import datetime
import pandas as pd

HERE = Path(__file__).parent
OUT = HERE / "data"
OUT.mkdir(exist_ok=True)
DL = HERE / "downloads"
DL.mkdir(exist_ok=True)

PROJ_WEB = Path("/Users/jamiegruffydd-jones/Documents/Documents - Jamie MacBook Air/Projects/GSI/data/Website")
SIGNING_XLSX = PROJ_WEB / "Website (filled).xlsx"
MEDIA_XLSX = PROJ_WEB / "GSI_media website.xlsx"
EXP_XLSX = PROJ_WEB / "China_Security_and_Surveillance_Dataset website.xlsx"

# Sentence-level media corpus (source of truth for the quarterly time series)
MEDIA_SENT_DIR = Path("/Users/jamiegruffydd-jones/Documents/Documents - Jamie MacBook Air/Projects/GSI/data/Media/GSI/extracted")

# GSI doctrinal phrases tracked as their own lines on the quarterly chart.
# (regex, display label) — matched case-insensitively on the raw Sentence text.
# NB: the corpus says "legitimate security concerns" (43 sentences), never
# "legitimate security interests" (0). "concerns" is the canonical GSI phrasing.
MEDIA_PHRASES = [
    (r"indivisible",          "Indivisible security"),
    (r"legitimate security",  "Legitimate security concerns"),
]

CLG = Path("/Users/jamiegruffydd-jones/Documents/Documents - Jamie MacBook Air/Projects/GSI/data/Security/security/data/AidData_CLG_security_coded.xlsx")
WORLD_SRC = Path("/Users/jamiegruffydd-jones/Documents/Documents - Jamie MacBook Air/Projects/International order/websites/chinamfa/data/world.geojson")

CITATION = "Gruffydd-Jones, J. (2026). GSI Datasets. https://github.com/jjgj/gsi-datasets"

# Threshold for showing countries on the media map (avoid noise)
MEDIA_MIN_MENTIONS = 25


# ---- Country-name → ISO3 (reused across all sources) ------------------
def name_to_iso3_map() -> dict:
    full = pd.read_excel(CLG, sheet_name="CLG-Global 1.0_Records",
                         usecols=["Country_of_Activity", "Country_of_Activity_ISO3"])
    base = (full.dropna().drop_duplicates()
            .set_index("Country_of_Activity")["Country_of_Activity_ISO3"].to_dict())
    extras = {
        "United States": "USA", "United Kingdom": "GBR", "South Korea": "KOR",
        "North Korea": "PRK", "DRC": "COD", "Democratic Republic of the Congo": "COD",
        "Democratic Republic of Congo": "COD", "Republic of the Congo": "COG",
        "Czech Republic": "CZE", "Czechia": "CZE", "Russia": "RUS", "Iran": "IRN",
        "Syria": "SYR", "Venezuela": "VEN", "Vietnam": "VNM", "Laos": "LAO",
        "Slovakia": "SVK", "Cape Verde": "CPV", "Cabo Verde": "CPV",
        "Eswatini": "SWZ", "Burma": "MMR", "Myanmar": "MMR",
        "Cote d'Ivoire": "CIV", "Ivory Coast": "CIV", "Côte d'Ivoire": "CIV",
        "East Timor": "TLS", "Timor-Leste": "TLS", "Brunei": "BRN",
        "Singapore": "SGP", "Bolivia": "BOL", "Tanzania": "TZA",
        "Macedonia": "MKD", "North Macedonia": "MKD",
        "Palestine": "PSE", "Hong Kong": "HKG", "Taiwan": "TWN",
        "Bahamas": "BHS", "Trinidad and Tobago": "TTO",
        "United Arab Emirates": "ARE", "South Sudan": "SSD",
        "Greenland": "GRL", "Belize": "BLZ", "Bhutan": "BTN",
        "Kyrgyzstan": "KGZ", "Bosnia and Herzegovina": "BIH",
        "Bosnia Herzegovina": "BIH", "Cook Islands": "COK", "Cook Isds": "COK",
        "Faroe Islands": "FRO", "Faroe Isds": "FRO", "Liechtenstein": "LIE",
        "Tuvalu": "TUV", "Federated States of Micronesia": "FSM",
        "Micronesia": "FSM", "Marshall Islands": "MHL", "Palau": "PLW",
        "Vatican": "VAT", "Holy See": "VAT",
        "São Tomé and Príncipe": "STP", "Sao Tome and Principe": "STP",
        "Saint Kitts and Nevis": "KNA", "Saint Lucia": "LCA",
        "Saint Vincent and the Grenadines": "VCT", "Antigua and Barbuda": "ATG",
        "Vanuatu": "VUT", "Solomon Islands": "SLB", "Samoa": "WSM",
        "Tonga": "TON", "Fiji": "FJI", "Kiribati": "KIR", "Nauru": "NRU",
        "Maldives": "MDV", "Mauritius": "MUS", "Comoros": "COM",
        "Equatorial Guinea": "GNQ",
    }
    return {**base, **extras}


def safe_int(v):
    try:
        return int(v) if pd.notna(v) else None
    except (ValueError, TypeError):
        return None


# ---- Country master ---------------------------------------------------
def build_country_master(name_map):
    sign = pd.read_excel(SIGNING_XLSX, sheet_name="Map")
    sign["country"] = sign["country"].astype(str).str.strip()
    sign["iso3"] = sign["country"].map(name_map)
    sign = sign.dropna(subset=["iso3"])
    sign = sign.drop_duplicates(subset=["iso3"])
    keep = {
        "iso3": "iso3", "country": "name",
        "Vdem": "vdem_regime_label", "EDI": "EDI",
        "US ally RAND": "rand_ally",
        "China_level": "China_level",
        "China ally level": "China_ally_label",
        "China_ally": "China_ally",
        "OECD country or not": "OECD",
        "China's neighbor or not": "China_neighbor",
        "BRICS or not": "BRICS_member",
        "year": "year",
    }
    cols = [c for c in keep if c in sign.columns]
    out = sign[cols].rename(columns={k: v for k, v in keep.items() if k in cols})
    for c in ("rand_ally", "China_ally"):
        if c in out.columns:
            out[c] = pd.to_numeric(out[c], errors="coerce").fillna(0).astype(int)
    for c in ("China_level", "EDI", "year"):
        if c in out.columns:
            out[c] = pd.to_numeric(out[c], errors="coerce")
    out["year"] = out["year"].astype("Int64")
    out["China_level"] = out["China_level"].astype("Int64")
    out["EDI"] = out["EDI"].round(2)
    # media_region — for showing per-country mean sentiment as fallback
    media_region = iso3_to_media_region()
    out["media_region"] = out["iso3"].apply(media_region)
    out = out.where(pd.notnull(out), None)
    return out


def iso3_to_media_region():
    NATO = {"USA","GBR","FRA","DEU","ITA","CAN","ESP","BEL","NLD","NOR","PRT","DNK","ISL","LUX","GRC","TUR","POL","CZE","HUN","ROU","BGR","EST","LVA","LTU","ALB","HRV","MNE","SVK","SVN","MKD","FIN","SWE","AUS","NZL","JPN","KOR","PHL","THA"}
    EU = {"AUT","IRL","MLT","CYP"}
    BRICS = {"BRA","RUS","IND","CHN","ZAF","EGY","ETH","IRN","ARE"}
    SCO = {"CHN","RUS","KAZ","KGZ","TJK","UZB","IND","PAK","IRN","BLR"}
    ASEAN = {"BRN","KHM","IDN","LAO","MYS","MMR","PHL","SGP","THA","VNM"}
    AU = {"DZA","AGO","BEN","BWA","BFA","BDI","CMR","CPV","CAF","TCD","COM","COG","COD","CIV","DJI","EGY","GNQ","ERI","SWZ","ETH","GAB","GMB","GHA","GIN","GNB","KEN","LSO","LBR","LBY","MDG","MWI","MLI","MRT","MUS","MAR","MOZ","NAM","NER","NGA","RWA","SEN","SLE","SOM","ZAF","SSD","SDN","TZA","TGO","TUN","UGA","ZMB","ZWE","STP","SYC"}
    def cls(iso3):
        if iso3 in NATO: return "USA/NATO"
        if iso3 in BRICS: return "BRICS"
        if iso3 in SCO: return "SCO"
        if iso3 in ASEAN: return "ASEAN"
        if iso3 in EU: return "EU"
        if iso3 in AU: return "AU"
        return "UN"
    return cls


# ---- Signings ---------------------------------------------------------
def build_signings(name_map):
    sign = pd.read_excel(SIGNING_XLSX, sheet_name="Map")
    sign["country"] = sign["country"].astype(str).str.strip()
    sign["iso3"] = sign["country"].map(name_map)
    sign = sign.dropna(subset=["iso3"])

    keep = {
        "country": "country", "iso3": "iso3", "year": "year",
        "Forum": "Forum",
        "Language Used": "LanguageUsed",
        "Joint statement": "JointStatement",
        "Ranking": "Ranking",
        "Implement": "Implement",
        "Level of public support": "LevelOfSupport",
        "China ally level": "China_ally_label",
        "China_level": "China_level",
        "China_ally": "China_ally",
        "OECD country or not": "OECD",
        "China's neighbor or not": "China_neighbor",
        "BRICS or not": "BRICS_member",
        "US ally RAND": "US_ally_RAND",
        "US arms 2022": "US_arms_2022",
        "China arms 2022": "China_arms_2022",
        "Vdem": "vdem_regime_label",
        "EDI": "EDI",
    }
    cols = [c for c in keep if c in sign.columns]
    out = sign[cols].rename(columns={k: v for k, v in keep.items() if k in cols})

    for c in ("year","Ranking","JointStatement","China_level","China_ally",
              "US_ally_RAND","US_arms_2022","China_arms_2022","EDI"):
        if c in out.columns:
            out[c] = pd.to_numeric(out[c], errors="coerce")
    out["year"] = out["year"].astype("Int64")
    out["Ranking"] = out["Ranking"].astype("Int64")
    out["China_level"] = out["China_level"].astype("Int64")

    # Normalise NaN strings -> None
    out = out.where(pd.notnull(out), None)
    # Clean string fields
    for c in ("Forum", "LanguageUsed", "Implement", "LevelOfSupport",
              "China_ally_label", "OECD", "China_neighbor", "BRICS_member"):
        if c in out.columns:
            out[c] = out[c].apply(lambda v: None if (v is None or (isinstance(v, str) and v.strip() == '' or v == 'nan')) else (v.strip() if isinstance(v, str) else v))
    return out


# ---- Media (from GSI_media website.xlsx) ------------------------------
def _load_media_sentences():
    """Combined MFA + Xinhua sentence-level corpus with a quarter column.
    Source of truth for the quarterly time series; reproduces the
    'sent by source x quarter' sheet exactly and lets us add article
    counts and doctrinal-phrase lines."""
    mfa = pd.read_csv(MEDIA_SENT_DIR / "MFAsentence.csv"); mfa["publication"] = "MFA"
    xin = pd.read_csv(MEDIA_SENT_DIR / "Xinhuasentence.csv"); xin["publication"] = "Xinhua"
    df = pd.concat([mfa, xin], ignore_index=True)
    df["quarter"] = pd.to_datetime(df["Date"], errors="coerce").dt.to_period("Q").astype(str)
    return df


def _agg_quarter(sub, source_label):
    """Aggregate a sentence subset to source × quarter × publication rows,
    plus a publication='both' combined row. n_articles = distinct Article_ID."""
    out = []
    for pub_label, frame in [("MFA", sub[sub.publication == "MFA"]),
                             ("Xinhua", sub[sub.publication == "Xinhua"]),
                             ("both", sub)]:
        g = (frame.groupby("quarter")
             .agg(n_sentences=("sent_score", "size"),
                  mean_sent=("sent_score", "mean"),
                  n_articles=("Article_ID", "nunique"))
             .reset_index())
        g["source"] = source_label
        g["publication"] = pub_label
        g["mean_sent"] = g["mean_sent"].round(4)
        g["n_sentences"] = g["n_sentences"].astype(int)
        g["n_articles"] = g["n_articles"].astype(int)
        out.append(g)
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame()


# ---- regime / alliance time-series (country-tagged) -------------------
_COUNTRY_PATTERNS = None
def _country_patterns():
    """The 171-country regex map maintained for the V-Dem charts (parsed
    without importing the module, which pulls in matplotlib)."""
    global _COUNTRY_PATTERNS
    if _COUNTRY_PATTERNS is None:
        import ast
        p = Path("/Users/jamiegruffydd-jones/Documents/Documents - Jamie MacBook Air/"
                 "Projects/GSI/data/Security/security/scripts/gsi_media_sentiment_charts.py")
        m = re.search(r"COUNTRY_PATTERNS\s*=\s*(\{.*?\n\})", p.read_text(), re.S)
        _COUNTRY_PATTERNS = ast.literal_eval(m.group(1))
    return _COUNTRY_PATTERNS


def _regime_ally_maps(cm):
    """iso3 -> Authoritarian/Democratic (V-Dem RoW, collapsed) and US ally/Non-ally (RAND)."""
    AUTH = {"Closed Autocracy", "Electoral Autocracy"}
    DEM = {"Electoral Democracy", "Liberal Democracy"}
    iso_regime, iso_ally = {}, {}
    for _, r in cm.iterrows():
        lab = r.get("vdem_regime_label")
        if lab in AUTH:
            iso_regime[r["iso3"]] = "Authoritarian"
        elif lab in DEM:
            iso_regime[r["iso3"]] = "Democratic"
        iso_ally[r["iso3"]] = "US ally" if r.get("rand_ally") == 1 else "Non-ally"
    return iso_regime, iso_ally


def _regime_ally_parts(uniq, cm):
    """Country-tag each (unique) sentence, fold to regime/alliance categories,
    and aggregate each as its own quarterly series. A sentence referencing both
    an authoritarian and a democratic country contributes to both."""
    iso_regime, iso_ally = _regime_ally_maps(cm)
    s = uniq["Sentence"].astype(str)
    cat_mask = {c: pd.Series(False, index=uniq.index)
                for c in ("Authoritarian", "Democratic", "US ally", "Non-ally")}
    for iso, pat in _country_patterns().items():
        reg, ally = iso_regime.get(iso), iso_ally.get(iso)
        if not reg and not ally:
            continue
        m = s.str.contains(pat, case=False, regex=True, na=False)
        if reg:
            cat_mask[reg] = cat_mask[reg] | m
        if ally:
            cat_mask[ally] = cat_mask[ally] | m
    parts = []
    for cat, m in cat_mask.items():
        sub = uniq[m]
        if len(sub):
            parts.append(_agg_quarter(sub, cat))
    return parts


def build_media_quarterly(cm):
    df = _load_media_sentences()
    # unique sentences (the source column multi-tags a sentence once per group);
    # corpus / phrase / regime-ally lines must not double-count those rows.
    uniq = df.drop_duplicates(subset=["Article_ID", "Sentence"])
    parts = []
    # Regional source-group lines (one tagged row per referenced group)
    for src in sorted(df["source"].dropna().unique()):
        parts.append(_agg_quarter(df[df["source"] == src], src))
    # Corpus-wide 'All articles' line (unique sentences)
    parts.append(_agg_quarter(uniq, "All articles"))
    # Regime / alliance lines (country-tagged, unique sentences)
    parts.extend(_regime_ally_parts(uniq, cm))
    # GSI doctrinal-phrase lines (a sentence may match more than one)
    for pat, label in MEDIA_PHRASES:
        sub = uniq[uniq["Sentence"].str.contains(pat, case=False, na=False, regex=True)]
        if len(sub):
            parts.append(_agg_quarter(sub, label))
    out = pd.concat(parts, ignore_index=True)
    out = out[["source", "publication", "quarter", "n_sentences", "mean_sent", "n_articles"]]
    return json.loads(out.where(pd.notnull(out), None).to_json(orient="records"))


def build_media_by_source():
    src = pd.read_excel(MEDIA_XLSX, sheet_name="sent by source group")
    return json.loads(src.where(pd.notnull(src), None).to_json(orient="records"))


def build_media_mentions_by_month():
    """The monthly mentions+sentiment+breakdown sheet from GSI_media website.xlsx."""
    df = pd.read_excel(MEDIA_XLSX, sheet_name="Mentions by month")
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce").dt.strftime("%Y-%m-%d")
    return json.loads(df.where(pd.notnull(df), None).to_json(orient="records"))


def build_media_by_country(name_map):
    """The 'By country' sheet — total mentions + mean sentiment per country."""
    df = pd.read_excel(MEDIA_XLSX, sheet_name="By country")
    df.columns = [str(c).strip() for c in df.columns]
    df["COUNTRY"] = df["COUNTRY"].astype(str).str.strip()
    df["iso3"] = df["COUNTRY"].map(name_map)
    unmatched = df[df["iso3"].isna()]["COUNTRY"].tolist()
    if unmatched:
        print(f"    WARN: media by-country unmatched: {unmatched[:8]}{'...' if len(unmatched) > 8 else ''}")
    df = df.dropna(subset=["iso3"])
    df["Total"] = pd.to_numeric(df["Total"], errors="coerce").fillna(0)
    df["Sentiment"] = pd.to_numeric(df["Sentiment"], errors="coerce")
    df = df[["COUNTRY", "iso3", "Total", "Sentiment", "Support GSI", "US ally1", "China_ally"]]
    df = df.rename(columns={"COUNTRY": "country", "Total": "mentions",
                            "Sentiment": "mean_sentiment",
                            "Support GSI": "support_gsi",
                            "US ally1": "US_ally",
                            "China_ally": "China_ally"})
    df["mean_sentiment"] = df["mean_sentiment"].round(4)
    df = df.where(pd.notnull(df), None)
    return json.loads(df.to_json(orient="records"))


def build_media_articles():
    art = pd.read_excel(MEDIA_XLSX, sheet_name="articles")
    art = art.copy()
    if "Date" in art.columns:
        art["Date"] = pd.to_datetime(art["Date"], errors="coerce").dt.strftime("%Y-%m-%d")
    art["Headline"] = art["Headline"].astype(str).str.slice(0, 220)
    art["snippet"] = art["Article"].astype(str).str.slice(0, 300).str.replace(r"\s+", " ", regex=True)
    art["body"] = art["Article"].astype(str).str.replace(r"\s+\n", "\n", regex=True).str.strip()
    keep = ["publication", "ID", "Date", "Headline", "snippet", "body", "sent_score"]
    out = art[[c for c in keep if c in art.columns]].copy()
    if "sent_score" in out.columns:
        out["sent_score"] = pd.to_numeric(out["sent_score"], errors="coerce").round(3)
    return json.loads(out.where(pd.notnull(out), None).to_json(orient="records"))


# ---- Expenditure (from new combined xlsx) -----------------------------
def build_expenditure(name_map):
    sec = pd.read_excel(EXP_XLSX, sheet_name="Security")
    surv = pd.read_excel(EXP_XLSX, sheet_name="Surveillance")
    combined = pd.concat([sec, surv], ignore_index=True)
    combined["Recipient"] = combined["Recipient"].astype(str).str.strip()
    combined["iso3"] = combined["Recipient"].map(name_map)
    unmatched = combined[combined["iso3"].isna()]["Recipient"].unique()
    if len(unmatched):
        print(f"    WARN: expenditure unmatched: {list(unmatched)[:8]}")
    combined = combined.dropna(subset=["iso3"])
    combined["year"] = pd.to_numeric(combined["year"], errors="coerce").astype("Int64")
    combined["amt_2023"] = pd.to_numeric(combined["amt_2023"], errors="coerce").fillna(0)
    combined = combined.where(pd.notnull(combined), None)
    keep = ["dataset", "AidData Record ID", "Recipient", "iso3", "year",
            "Sector Name", "Funding Agencies", "Direct Receiving Agencies",
            "Title", "Description", "Flow Type Simplified", "amt_2023"]
    out = combined[[c for c in keep if c in combined.columns]].copy()
    out = out.rename(columns={
        "AidData Record ID": "record_id",
        "Recipient": "recipient",
        "Sector Name": "sector",
        "Funding Agencies": "funder",
        "Direct Receiving Agencies": "receiving_agency",
        "Title": "title", "Description": "description",
        "Flow Type Simplified": "flow_type"
    })
    out["description"] = out["description"].astype(str).str.slice(0, 600).str.replace(r"\s+", " ", regex=True)
    out["title"] = out["title"].astype(str).str.slice(0, 300)

    deals = json.loads(out.where(pd.notnull(out), None).to_json(orient="records"))

    # Country × year aggregate (separately by dataset, but combined for the map)
    cy = (out.groupby(["iso3", "year"], dropna=False, as_index=False)["amt_2023"]
            .sum())
    cy = cy.where(pd.notnull(cy), None)
    country = json.loads(cy.to_json(orient="records"))

    return deals, country


# ---- Build & write ----------------------------------------------------
def main():
    name_map = name_to_iso3_map()

    print("Building country_master...")
    cm = build_country_master(name_map)
    print(f"  -> {len(cm)} countries")

    print("Building signings...")
    signings = build_signings(name_map)
    print(f"  -> {len(signings)} rows")

    print("Building media quarterly + by source...")
    mqx = build_media_quarterly(cm)
    msrc = build_media_by_source()
    print(f"  -> quarterly: {len(mqx)} rows; by-source: {len(msrc)} rows")

    print("Building media monthly mentions...")
    mmon = build_media_mentions_by_month()
    print(f"  -> {len(mmon)} months")

    print("Building media by country (>=", MEDIA_MIN_MENTIONS, "mentions)...")
    mbc_all = build_media_by_country(name_map)
    mbc = [r for r in mbc_all if (r["mentions"] or 0) >= MEDIA_MIN_MENTIONS]
    print(f"  -> {len(mbc)} countries above threshold ({len(mbc_all)} total)")

    print("Building media articles (lean)...")
    arts = build_media_articles()
    print(f"  -> {len(arts)} articles")

    print("Building expenditure (deals + country-year)...")
    deals, ec = build_expenditure(name_map)
    print(f"  -> {len(deals)} deals, {len(ec)} country-years")

    # ---- Write JSON ----
    def w(path, obj):
        with open(OUT / path, "w", encoding="utf-8") as f:
            json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
        print(f"  saved data/{path}  ({(OUT / path).stat().st_size // 1024} KB)")

    w("country_master.json", json.loads(cm.to_json(orient="records")))
    w("signings.json", json.loads(signings.to_json(orient="records")))
    w("media_quarterly.json", mqx)
    w("media_by_source.json", msrc)
    w("media_mentions_by_month.json", mmon)
    w("media_by_country.json", mbc)
    w("media_by_country_all.json", mbc_all)
    w("media_articles.json", arts)
    w("expenditure_deals.json", deals)
    w("expenditure_country.json", ec)

    if WORLD_SRC.exists() and not (OUT / "world.geojson").exists():
        shutil.copy(WORLD_SRC, OUT / "world.geojson")
        print("  copied world.geojson from chinamfa template")

    today = datetime.now().strftime("%Y-%m-%d")
    manifest = {
        "version": "v1.1",
        "build_date": today,
        "citation": CITATION,
        "datasets": {
            "signings": {"rows": len(signings), "coverage": "2022-2025"},
            "media": {"articles": len(arts), "countries_in_map": len(mbc),
                      "country_mention_threshold": MEDIA_MIN_MENTIONS},
            "expenditure": {"deals": len(deals),
                            "coverage": "2000-2023 (surveillance 2003-2021)"},
        }
    }
    with open(OUT / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print("  saved data/manifest.json")

    # ---- Downloads ----
    print("Copying download CSVs...")
    cite_hdr = f"# Source: GSI Datasets | Cite as: {CITATION} | Build: {today}\n"
    for src, dst_name in [
        (SIGNING_XLSX, "GSI_signings_v1.csv"),
        (EXP_XLSX, "GSI_security_surveillance_v1.csv"),
        (MEDIA_XLSX, "GSI_media_v1.xlsx"),
    ]:
        if src.suffix == ".xlsx":
            if dst_name.endswith(".xlsx"):
                shutil.copy(src, DL / dst_name)
            else:
                # collapse the security + surveillance sheets into one CSV
                if "security_surveillance" in dst_name:
                    sec = pd.read_excel(src, sheet_name="Security")
                    surv = pd.read_excel(src, sheet_name="Surveillance")
                    out = pd.concat([sec, surv], ignore_index=True)
                else:
                    out = pd.read_excel(src, sheet_name="Map" if "Map" in pd.ExcelFile(src).sheet_names else 0)
                csv_path = DL / dst_name
                with open(csv_path, "w") as f:
                    f.write(cite_hdr)
                    out.to_csv(f, index=False)
        print(f"  saved downloads/{dst_name}")

    print("\nDone.")


if __name__ == "__main__":
    main()
