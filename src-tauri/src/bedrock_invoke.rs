//! AWS Bedrock `invoke_model` for Anthropic Claude payloads (same JSON shape as Anthropic Messages API).

use aws_config::BehaviorVersion;
use aws_sdk_bedrockruntime::config::Region;
use aws_sdk_bedrockruntime::primitives::Blob;

#[tauri::command]
pub async fn bedrock_invoke_model(region: String, model_id: String, body_json: String) -> Result<String, String> {
    let region_ref = Region::new(region.clone());
    let conf = aws_config::defaults(BehaviorVersion::latest())
        .region(region_ref)
        .load()
        .await;
    let client = aws_sdk_bedrockruntime::Client::new(&conf);
    let out = client
        .invoke_model()
        .model_id(model_id)
        .content_type("application/json")
        .accept("application/json")
        .body(Blob::new(body_json.into_bytes()))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let bytes = out.body().as_ref().to_vec();
    String::from_utf8(bytes).map_err(|e| e.to_string())
}
