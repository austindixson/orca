import { Composition } from "remotion";
import { SwissModernPresentation } from "./compositions/SwissModernPresentation";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AgentCanvasVideo"
        component={SwissModernPresentation}
        durationInFrames={1080}
        fps={60}
        width={1920}
        height={1080}
        defaultProps={{
          slideCount: 9,
        }}
      />
    </>
  );
};
