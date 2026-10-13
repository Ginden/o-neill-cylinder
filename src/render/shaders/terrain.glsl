uniform vec2 uAtlasResolution;
uniform bool uBakeCover;
out vec4 outColor;
void main() {
  vec2 uv=gl_FragCoord.xy/uAtlasResolution;
  vec2 ground=vec2(uv.x*2.0*PI*uRadius,(uv.y-0.5)*uLength);
  outColor=uBakeCover ? landCover(ground) : vec4(groundHeight(ground),0.0,0.0,1.0);
}
