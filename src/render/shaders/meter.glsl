uniform sampler2D uImage;
uniform float uReferenceIlluminance;
out vec4 outColor;
void main() {
  float luminance=0.0;
  // Stratified area metering avoids a single center sightline setting exposure.
  for(int y=0;y<4;y++) for(int x=0;x<4;x++) {
    vec2 uv=(gl_FragCoord.xy-0.5+(vec2(x,y)+0.5)/4.0)/32.0;
    luminance+=texture(uImage,uv).g;
  }
  outColor=vec4(luminance*uReferenceIlluminance/16.0,0.0,0.0,1.0);
}
