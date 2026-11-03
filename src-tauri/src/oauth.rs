//! Direct, Rust-owned native OAuth requests. No provider response crosses IPC.
use futures_util::StreamExt;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use reqwest::{Client, RequestBuilder, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const INVALID: &str = "Invalid native sign-in configuration";
const INVALID_TOKEN: &str = "The sign-in service returned an invalid credential";
pub const SCOPES: &str = "openid profile email offline_access";

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub issuer: String,
    jwks_url: String,
    pub client_id: String,
    pub resource: String,
    protocol_version: u8,
    redirect_uri: String,
    discovery_url: String,
    scopes: String,
}

fn checked_https(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| INVALID)?;
    if url.scheme() != "https"
        || url.as_str() != value
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(INVALID.into());
    }
    Ok(url)
}

/// Build-provided public authorities. Never deserialize pins from an API response.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Authority {
    api_origin: String,
    issuer: String,
    jwks_url: String,
    client_id: String,
    resource: String,
}
pub type Authorities = std::collections::HashMap<String, Authority>;
pub fn authorities(encoded: &str) -> Result<Authorities, String> {
    let entries: Vec<Authority> = serde_json::from_str(encoded).map_err(|_| INVALID)?;
    let mut map = Authorities::new();
    let mut issuers = std::collections::HashSet::new();
    for entry in entries {
        let issuer = checked_https(&entry.issuer)?;
        checked_https(&entry.jwks_url)?;
        if crate::auth::auth_origin(&entry.api_origin)? != entry.api_origin
            || entry.resource != entry.api_origin
            || issuer.path().ends_with('/')
            || entry.client_id.trim().is_empty()
            || !issuers.insert(issuer.origin().ascii_serialization())
            || map.contains_key(&entry.api_origin)
        {
            return Err(INVALID.into());
        }
        map.insert(entry.api_origin.clone(), entry);
    }
    Ok(map)
}
impl Authority {
    pub fn trusts(&self, config: &Config) -> bool {
        self.issuer == config.issuer
            && self.jwks_url == config.jwks_url
            && self.resource == config.resource
            && self.client_id == config.client_id
    }
}
impl Config {
    pub async fn load(client: &Client, pin: &Authority) -> Result<Self, String> {
        let config: Self =
            json(client.get(format!("{}/v1/auth/native/config", pin.api_origin))).await?;
        config.validate()?;
        if !pin.trusts(&config) {
            return Err("The server sign-in configuration does not match this Studio build".into());
        }
        Ok(config)
    }
    pub(super) fn validate(&self) -> Result<(), String> {
        let branch = checked_https(&self.issuer)?;
        checked_https(&self.jwks_url)?;
        // The API resource is an audience identifier and may omit the root slash.
        let resource = Url::parse(&self.resource).map_err(|_| INVALID)?;
        checked_https(resource.as_str())?;
        if branch.path().ends_with('/')
            || self.protocol_version != 2
            || self.client_id.trim().is_empty()
            || self.redirect_uri != super::auth::REDIRECT_URI
            || self.scopes != SCOPES
            || self.discovery_url
                != format!("{}/.well-known/oauth-authorization-server", self.issuer)
        {
            return Err(INVALID.into());
        }
        Ok(())
    }
    fn endpoint(&self, value: &str) -> Result<(), String> {
        let url = checked_https(value)?;
        let issuer = checked_https(&self.issuer)?;
        if url.origin() != issuer.origin()
            || !url.path().starts_with(&format!("{}/", issuer.path()))
        {
            return Err(INVALID.into());
        }
        Ok(())
    }
}

async fn json<T: DeserializeOwned>(request: RequestBuilder) -> Result<T, String> {
    let response = request
        .timeout(Duration::from_secs(12))
        .send()
        .await
        .map_err(|_| "Could not contact the sign-in service")?;
    if !response.status().is_success() {
        return Err("The sign-in service declined the request".into());
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "Incomplete sign-in response")?;
        if bytes.len() + chunk.len() > 128 * 1024 {
            return Err("Oversized sign-in response".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid sign-in response".into())
}

#[derive(Clone, Deserialize)]
pub struct Metadata {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub revocation_endpoint: Option<String>,
}
#[derive(Deserialize)]
struct Keys {
    keys: Vec<Key>,
}
#[derive(Deserialize)]
struct Key {
    kid: Option<String>,
    kty: String,
    crv: Option<String>,
    x: Option<String>,
    alg: Option<String>,
    #[serde(rename = "use")]
    usage: Option<String>,
    key_ops: Option<Vec<String>>,
}
#[derive(Deserialize)]
struct Grant {
    access_token: String,
    refresh_token: String,
    token_type: String,
}
#[derive(Deserialize)]
struct Claims {
    sub: String,
    exp: u64,
    iat: u64,
    #[serde(default)]
    nbf: u64,
    client_id: String,
    #[serde(rename = "isAnonymous", default)]
    anonymous: bool,
    #[serde(default)]
    banned: bool,
}
pub struct VerifiedGrant {
    pub access: String,
    pub refresh: String,
    pub subject: String,
    pub expires: u64,
}

pub struct Provider {
    pub config: Config,
    metadata: Option<(Instant, Metadata)>,
    keys: Option<(Instant, Keys)>,
}
impl Provider {
    pub fn new(config: Config) -> Self {
        Self {
            config,
            metadata: None,
            keys: None,
        }
    }
    pub async fn discover(&mut self, client: &Client) -> Result<Metadata, String> {
        if let Some((at, m)) = &self.metadata {
            if at.elapsed() < Duration::from_secs(3600) {
                return Ok(m.clone());
            }
        }
        let m: Metadata = json(client.get(&self.config.discovery_url)).await?;
        if m.issuer != self.config.issuer {
            return Err(INVALID.into());
        }
        self.config.endpoint(&m.authorization_endpoint)?;
        self.config.endpoint(&m.token_endpoint)?;
        if let Some(endpoint) = &m.revocation_endpoint {
            self.config.endpoint(endpoint)?;
        }
        self.metadata = Some((Instant::now(), m.clone()));
        Ok(m)
    }
    pub async fn exchange(
        &mut self,
        client: &Client,
        endpoint: &str,
        fields: &[(&str, &str)],
    ) -> Result<VerifiedGrant, String> {
        let mut form = fields.to_vec();
        form.extend([
            ("client_id", self.config.client_id.as_str()),
            ("resource", self.config.resource.as_str()),
        ]);
        let grant: Grant = json(client.post(endpoint).form(&form)).await?;
        if !grant.token_type.eq_ignore_ascii_case("bearer")
            || grant.refresh_token.trim().is_empty()
            || grant.access_token.len() > 16384
        {
            return Err(INVALID_TOKEN.into());
        }
        let header = decode_header(&grant.access_token).map_err(|_| INVALID_TOKEN)?;
        let kid = header
            .kid
            .filter(|id| !id.is_empty())
            .ok_or(INVALID_TOKEN)?;
        if header.alg != Algorithm::EdDSA {
            return Err(INVALID_TOKEN.into());
        }
        let fresh = self.keys.as_ref().is_some_and(|(at, keys)| {
            at.elapsed() < Duration::from_secs(600)
                && (at.elapsed() < Duration::from_secs(30)
                    || keys.keys.iter().any(|key| key.kid.as_deref() == Some(&kid)))
        });
        if !fresh {
            self.keys = Some((
                Instant::now(),
                json(client.get(&self.config.jwks_url)).await?,
            ));
        }
        let claims = self.verify(&grant.access_token, &kid, &self.keys.as_ref().unwrap().1)?;
        Ok(VerifiedGrant {
            access: grant.access_token,
            refresh: grant.refresh_token,
            subject: claims.sub,
            expires: claims.exp,
        })
    }
    fn verify(&self, token: &str, kid: &str, keys: &Keys) -> Result<Claims, String> {
        let mut matches = keys.keys.iter().filter(|k| k.kid.as_deref() == Some(kid));
        let k = matches.next().ok_or(INVALID_TOKEN)?;
        if matches.next().is_some()
            || k.kty != "OKP"
            || k.crv.as_deref() != Some("Ed25519")
            || k.alg.as_deref().is_some_and(|v| v != "EdDSA")
            || k.usage.as_deref().is_some_and(|v| v != "sig")
            || k.key_ops
                .as_ref()
                .is_some_and(|ops| !ops.iter().any(|op| op == "verify"))
        {
            return Err(INVALID_TOKEN.into());
        }
        let key = DecodingKey::from_ed_components(k.x.as_deref().ok_or(INVALID_TOKEN)?)
            .map_err(|_| INVALID_TOKEN)?;
        let mut validation = Validation::new(Algorithm::EdDSA);
        validation.set_issuer(&[&self.config.issuer]);
        validation.set_audience(&[&self.config.resource]);
        validation.set_required_spec_claims(&["exp", "sub", "iss", "aud"]);
        validation.validate_nbf = true;
        validation.leeway = 0;
        let claims = decode::<Claims>(token, &key, &validation)
            .map_err(|_| INVALID_TOKEN)?
            .claims;
        if claims.nbf > now()
            || claims.exp <= now()
            || claims.iat > now()
            || claims.iat >= claims.exp
            || claims.sub.trim().is_empty()
            || claims.client_id != self.config.client_id
            || claims.anonymous
            || claims.banned
        {
            return Err(INVALID_TOKEN.into());
        }
        Ok(claims)
    }

    pub async fn revoke(&mut self, client: &Client, refresh: &str) -> Result<(), String> {
        let url = self
            .discover(client)
            .await?
            .revocation_endpoint
            .ok_or("Revocation unavailable")?;
        let response = client
            .post(url)
            .timeout(Duration::from_secs(12))
            .form(&[
                ("client_id", self.config.client_id.as_str()),
                ("token", refresh),
                ("token_type_hint", "refresh_token"),
            ])
            .send()
            .await
            .map_err(|_| "Revocation unavailable")?;
        if !response.status().is_success() {
            return Err("Revocation unavailable".into());
        }
        Ok(())
    }
}

#[cfg(test)]
pub(super) mod fixture {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
    use ring::signature::{Ed25519KeyPair, KeyPair};
    use serde_json::{json, Value};
    pub const ISSUER: &str = "https://auth.test/neondb/auth";
    pub const ORIGIN: &str = "https://api.test";
    pub fn config() -> Config {
        Config {
            issuer: ISSUER.into(),
            jwks_url: format!("{ISSUER}/jwks"),
            client_id: "desktop-public".into(),
            resource: ORIGIN.into(),
            protocol_version: 2,
            redirect_uri: crate::auth::REDIRECT_URI.into(),
            discovery_url: format!("{ISSUER}/.well-known/oauth-authorization-server"),
            scopes: SCOPES.into(),
        }
    }
    fn key() -> Ed25519KeyPair {
        Ed25519KeyPair::from_seed_unchecked(&[3; 32]).unwrap()
    }
    pub fn claims() -> Value {
        json!({"iss":ISSUER,"aud":ORIGIN,"sub":"owner","iat":now()-30,"exp":now()+300,"client_id":"desktop-public"})
    }
    pub fn token(claims: Value) -> String {
        let data = format!(
            "{}.{}",
            B64.encode(br#"{"alg":"EdDSA","kid":"synthetic"}"#),
            B64.encode(claims.to_string())
        );
        format!("{data}.{}", B64.encode(key().sign(data.as_bytes())))
    }
    pub fn provider(endpoint: &str) -> Provider {
        let config = config();
        config.validate().unwrap();
        let mut provider = Provider::new(config);
        provider.metadata = Some((
            Instant::now(),
            Metadata {
                issuer: ISSUER.into(),
                authorization_endpoint: format!("{ISSUER}/authorize"),
                token_endpoint: endpoint.into(),
                revocation_endpoint: Some(endpoint.into()),
            },
        ));
        provider.keys = Some((
            Instant::now(),
            serde_json::from_value(
                json!({"keys":[{"kty":"OKP","crv":"Ed25519","kid":"synthetic",
            "alg":"EdDSA","use":"sig","x":B64.encode(key().public_key().as_ref())}]}),
            )
            .unwrap(),
        ));
        provider
    }
    #[test]
    fn signed_native_credentials_require_the_exact_branch_claim_contract() {
        let p = provider("");
        let keys = &p.keys.as_ref().unwrap().1;
        assert!(p.verify(&token(claims()), "synthetic", keys).is_ok());
        for (name, bad) in [
            ("iss", json!("https://auth.test")),
            ("aud", json!("https://auth.test")),
            ("client_id", json!("other")),
            ("sub", json!(" ")),
            ("exp", json!(now() - 1)),
            ("iat", json!(now() + 10)),
            ("nbf", json!(now() + 30)),
            ("banned", json!(true)),
            ("isAnonymous", json!(true)),
            ("iat", Value::Null),
            ("nbf", Value::Null),
            ("nbf", json!("invalid")),
            ("nbf", json!(-1)),
            ("nbf", json!(1e100)),
        ] {
            let mut c = claims();
            c[name] = bad;
            assert!(
                p.verify(&token(c), "synthetic", keys).is_err(),
                "claim {name}"
            );
        }
        let valid = token(claims());
        let (body, _) = valid.rsplit_once('.').unwrap();
        assert!(p
            .verify(
                &format!("{body}.{}", B64.encode([0; 64])),
                "synthetic",
                keys
            )
            .is_err());
        assert!(p.verify(&valid, "wrong-key", keys).is_err());
        let mut invalid_keys = serde_json::json!({"keys":[{"kid":"synthetic","kty":"OKP","crv":"Ed25519","x":B64.encode(key().public_key().as_ref())}]});
        let same = invalid_keys["keys"][0].clone();
        invalid_keys["keys"]
            .as_array_mut()
            .unwrap()
            .push(same.clone());
        assert!(p
            .verify(
                &valid,
                "synthetic",
                &serde_json::from_value(invalid_keys).unwrap()
            )
            .is_err());
        for (field, bad) in [
            ("alg", "Ed448"),
            ("crv", "X25519"),
            ("kty", "oct"),
            ("use", "enc"),
        ] {
            let mut invalid = same.clone();
            invalid[field] = bad.into();
            let keys = serde_json::from_value(serde_json::json!({"keys":[invalid]})).unwrap();
            assert!(p.verify(&valid, "synthetic", &keys).is_err());
        }
    }
    #[test]
    fn recipient_and_signing_authorities_are_independently_pinned() {
        let entry = json!({"apiOrigin":ORIGIN,"issuer":ISSUER,"resource":ORIGIN,"clientId":"desktop-public","jwksUrl":format!("{ISSUER}/jwks")});
        let pins = authorities(&json!([entry]).to_string()).unwrap();
        let pin = pins.get(ORIGIN).unwrap();
        assert!(pin.trusts(&config()));
        assert!(pins.get("https://attacker.test").is_none());
        let mut wrong = config();
        wrong.issuer = "https://auth.test/another/auth".into();
        assert!(!pin.trusts(&wrong));
        let mut other = entry.clone();
        other["apiOrigin"] = json!("https://custom.test");
        other["resource"] = other["apiOrigin"].clone();
        // Another branch on the same host mints browser credentials for the same issuer origin.
        other["issuer"] = json!("https://auth.test/other/auth");
        assert!(authorities(&json!([entry, other]).to_string()).is_err());
        assert!(authorities(&json!([entry, entry]).to_string()).is_err());
        let mut cross = entry.clone();
        cross["resource"] = json!("https://other.test");
        assert!(authorities(&json!([cross]).to_string()).is_err());
        let mut wrong = config();
        wrong.jwks_url = "https://other.test/keys".into();
        assert!(!pin.trusts(&wrong));
        let mut wrong = config();
        wrong.client_id = "another-client".into();
        assert!(!pin.trusts(&wrong));
    }
    #[test]
    fn discovery_cannot_redirect_credentials_to_another_origin_or_branch() {
        let c = config();
        assert!(c.endpoint(&format!("{ISSUER}/oauth2/token")).is_ok());
        for bad in [
            "https://auth.test/other/token",
            "https://auth.test/neondb/auth-evil/token",
            "https://evil.test/neondb/auth/token",
            "https://auth.test/neondb/auth/../other/token",
            "https://auth.test/neondb/auth/token?to=elsewhere",
        ] {
            assert!(c.endpoint(bad).is_err());
        }
    }
}
