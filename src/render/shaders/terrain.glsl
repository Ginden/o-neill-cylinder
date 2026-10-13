uniform vec2 uAtlasResolution;
out vec4 outColor;
void main() {
  vec2 uv=gl_FragCoord.xy/uAtlasResolution;
  float height=groundHeight(vec2((uv.x*2.0-1.0)*PI*uRadius,(uv.y-0.5)*uLength));
  outColor=vec4(height,0.0,0.0,1.0);
}
