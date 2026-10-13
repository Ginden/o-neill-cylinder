uniform sampler2D uImage;
uniform int uDiagnostic;
uniform vec2 uDisplayResolution;
out vec4 outColor;
void main() {
  vec3 color=texture(uImage,gl_FragCoord.xy/uDisplayResolution).rgb;
  if (uDiagnostic==0) color=displayColor(color);
  outColor=vec4(encodeSRGB(color),1.0);
}
