export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      Certificate: {
        Row: {
          arquivoUrl: string;
          createdAt: string;
          id: string;
          nome: string;
          userId: string;
        };
        Insert: {
          arquivoUrl: string;
          createdAt?: string;
          id: string;
          nome: string;
          userId: string;
        };
        Update: {
          arquivoUrl?: string;
          createdAt?: string;
          id?: string;
          nome?: string;
          userId?: string;
        };
        Relationships: [
          {
            foreignKeyName: "Certificate_userId_fkey";
            columns: ["userId"];
            isOneToOne: false;
            referencedRelation: "User";
            referencedColumns: ["id"];
          },
        ];
      };
      Conversation: {
        Row: {
          contractorId: string;
          createdAt: string;
          id: string;
          jobId: string | null;
          listingId: string | null;
          providerId: string;
          updatedAt: string;
        };
        Insert: {
          contractorId: string;
          createdAt?: string;
          id: string;
          jobId?: string | null;
          listingId?: string | null;
          providerId: string;
          updatedAt?: string;
        };
        Update: {
          contractorId?: string;
          createdAt?: string;
          id?: string;
          jobId?: string | null;
          listingId?: string | null;
          providerId?: string;
          updatedAt?: string;
        };
        Relationships: [
          {
            foreignKeyName: "Conversation_contractorId_fkey";
            columns: ["contractorId"];
            isOneToOne: false;
            referencedRelation: "User";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "Conversation_jobId_fkey";
            columns: ["jobId"];
            isOneToOne: false;
            referencedRelation: "Job";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "Conversation_listingId_fkey";
            columns: ["listingId"];
            isOneToOne: false;
            referencedRelation: "Listing";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "Conversation_providerId_fkey";
            columns: ["providerId"];
            isOneToOne: false;
            referencedRelation: "User";
            referencedColumns: ["id"];
          },
        ];
      };
      Job: {
        Row: {
          aCombinar: boolean;
          bairro: string | null;
          categoria: string;
          cep: string | null;
          cidade: string;
          createdAt: string;
          descricao: string;
          id: string;
          preco: number | null;
          status: Database["public"]["Enums"]["JobStatus"];
          telefone: string;
          titulo: string;
          uf: string;
          updatedAt: string;
          userId: string;
        };
        Insert: {
          aCombinar?: boolean;
          bairro?: string | null;
          categoria: string;
          cep?: string | null;
          cidade: string;
          createdAt?: string;
          descricao: string;
          id: string;
          preco?: number | null;
          status?: Database["public"]["Enums"]["JobStatus"];
          telefone: string;
          titulo: string;
          uf: string;
          updatedAt?: string;
          userId: string;
        };
        Update: {
          aCombinar?: boolean;
          bairro?: string | null;
          categoria?: string;
          cep?: string | null;
          cidade?: string;
          createdAt?: string;
          descricao?: string;
          id?: string;
          preco?: number | null;
          status?: Database["public"]["Enums"]["JobStatus"];
          telefone?: string;
          titulo?: string;
          uf?: string;
          updatedAt?: string;
          userId?: string;
        };
        Relationships: [
          {
            foreignKeyName: "Job_userId_fkey";
            columns: ["userId"];
            isOneToOne: false;
            referencedRelation: "User";
            referencedColumns: ["id"];
          },
        ];
      };
      JobInterest: {
        Row: {
          createdAt: string;
          id: string;
          jobId: string;
          userId: string;
        };
        Insert: {
          createdAt?: string;
          id: string;
          jobId: string;
          userId: string;
        };
        Update: {
          createdAt?: string;
          id?: string;
          jobId?: string;
          userId?: string;
        };
        Relationships: [
          {
            foreignKeyName: "JobInterest_jobId_fkey";
            columns: ["jobId"];
            isOneToOne: false;
            referencedRelation: "Job";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "JobInterest_userId_fkey";
            columns: ["userId"];
            isOneToOne: false;
            referencedRelation: "User";
            referencedColumns: ["id"];
          },
        ];
      };
      Listing: {
        Row: {
          aCombinar: boolean;
          bairro: string | null;
          categoria: string;
          cep: string | null;
          cidade: string;
          createdAt: string;
          descricao: string;
          id: string;
          preco: number | null;
          status: Database["public"]["Enums"]["ListingStatus"];
          telefone: string;
          tipo: Database["public"]["Enums"]["ListingType"];
          titulo: string;
          uf: string;
          updatedAt: string;
          userId: string;
        };
        Insert: {
          aCombinar?: boolean;
          bairro?: string | null;
          categoria: string;
          cep?: string | null;
          cidade: string;
          createdAt?: string;
          descricao: string;
          id: string;
          preco?: number | null;
          status?: Database["public"]["Enums"]["ListingStatus"];
          telefone: string;
          tipo: Database["public"]["Enums"]["ListingType"];
          titulo: string;
          uf: string;
          updatedAt?: string;
          userId: string;
        };
        Update: {
          aCombinar?: boolean;
          bairro?: string | null;
          categoria?: string;
          cep?: string | null;
          cidade?: string;
          createdAt?: string;
          descricao?: string;
          id?: string;
          preco?: number | null;
          status?: Database["public"]["Enums"]["ListingStatus"];
          telefone?: string;
          tipo?: Database["public"]["Enums"]["ListingType"];
          titulo?: string;
          uf?: string;
          updatedAt?: string;
          userId?: string;
        };
        Relationships: [
          {
            foreignKeyName: "Listing_userId_fkey";
            columns: ["userId"];
            isOneToOne: false;
            referencedRelation: "User";
            referencedColumns: ["id"];
          },
        ];
      };
      ListingImage: {
        Row: {
          id: string;
          listingId: string;
          ordem: number;
          url: string;
        };
        Insert: {
          id: string;
          listingId: string;
          ordem?: number;
          url: string;
        };
        Update: {
          id?: string;
          listingId?: string;
          ordem?: number;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ListingImage_listingId_fkey";
            columns: ["listingId"];
            isOneToOne: false;
            referencedRelation: "Listing";
            referencedColumns: ["id"];
          },
        ];
      };
      Message: {
        Row: {
          content: string;
          conversationId: string;
          createdAt: string;
          id: string;
          proposalValue: number | null;
          readAt: string | null;
          senderId: string;
          transactionId: string | null;
          type: string;
        };
        Insert: {
          content: string;
          conversationId: string;
          createdAt?: string;
          id: string;
          proposalValue?: number | null;
          readAt?: string | null;
          senderId: string;
          transactionId?: string | null;
          type?: string;
        };
        Update: {
          content?: string;
          conversationId?: string;
          createdAt?: string;
          id?: string;
          proposalValue?: number | null;
          readAt?: string | null;
          senderId?: string;
          transactionId?: string | null;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "Message_conversationId_fkey";
            columns: ["conversationId"];
            isOneToOne: false;
            referencedRelation: "Conversation";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "Message_senderId_fkey";
            columns: ["senderId"];
            isOneToOne: false;
            referencedRelation: "User";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "Message_transactionId_fkey";
            columns: ["transactionId"];
            isOneToOne: false;
            referencedRelation: "Transaction";
            referencedColumns: ["id"];
          },
        ];
      };
      SupportTicket: {
        Row: {
          id: string;
          transactionId: string | null;
          conversationId: string | null;
          reporterId: string;
          descricao: string;
          comprovanteUrl: string | null;
          status: Database["public"]["Enums"]["SupportTicketStatus"];
          createdAt: string;
          updatedAt: string;
        };
        Insert: {
          id: string;
          transactionId?: string | null;
          conversationId?: string | null;
          reporterId: string;
          descricao: string;
          comprovanteUrl?: string | null;
          status?: Database["public"]["Enums"]["SupportTicketStatus"];
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          transactionId?: string | null;
          conversationId?: string | null;
          reporterId?: string;
          descricao?: string;
          comprovanteUrl?: string | null;
          status?: Database["public"]["Enums"]["SupportTicketStatus"];
          createdAt?: string;
          updatedAt?: string;
        };
        Relationships: [
          {
            foreignKeyName: "SupportTicket_transactionId_fkey";
            columns: ["transactionId"];
            isOneToOne: false;
            referencedRelation: "Transaction";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "SupportTicket_reporterId_fkey";
            columns: ["reporterId"];
            isOneToOne: false;
            referencedRelation: "User";
            referencedColumns: ["id"];
          },
        ];
      };
      Transaction: {
        Row: {
          id: string;
          listingId: string;
          contractorId: string;
          professionalId: string;
          asaasPaymentId: string | null;
          amountGross: number;
          platformFee: number;
          professionalNet: number;
          billingType: Database["public"]["Enums"]["BillingType"];
          status: Database["public"]["Enums"]["TransactionStatus"];
          pixQrCodeImage: string | null;
          pixCopyPaste: string | null;
          invoiceUrl: string | null;
          paymentLink: string | null;
          dueDate: string | null;
          paidAt: string | null;
          createdAt: string;
          updatedAt: string;
        };
        Insert: {
          id: string;
          listingId: string;
          contractorId: string;
          professionalId: string;
          asaasPaymentId?: string | null;
          amountGross: number;
          platformFee: number;
          professionalNet: number;
          billingType: Database["public"]["Enums"]["BillingType"];
          status?: Database["public"]["Enums"]["TransactionStatus"];
          pixQrCodeImage?: string | null;
          pixCopyPaste?: string | null;
          invoiceUrl?: string | null;
          paymentLink?: string | null;
          dueDate?: string | null;
          paidAt?: string | null;
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          listingId?: string;
          contractorId?: string;
          professionalId?: string;
          asaasPaymentId?: string | null;
          amountGross?: number;
          platformFee?: number;
          professionalNet?: number;
          billingType?: Database["public"]["Enums"]["BillingType"];
          status?: Database["public"]["Enums"]["TransactionStatus"];
          pixQrCodeImage?: string | null;
          pixCopyPaste?: string | null;
          invoiceUrl?: string | null;
          paymentLink?: string | null;
          dueDate?: string | null;
          paidAt?: string | null;
          createdAt?: string;
          updatedAt?: string;
        };
        Relationships: [
          {
            foreignKeyName: "Transaction_listingId_fkey";
            columns: ["listingId"];
            isOneToOne: false;
            referencedRelation: "Listing";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "Transaction_contractorId_fkey";
            columns: ["contractorId"];
            isOneToOne: false;
            referencedRelation: "User";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "Transaction_professionalId_fkey";
            columns: ["professionalId"];
            isOneToOne: false;
            referencedRelation: "User";
            referencedColumns: ["id"];
          },
        ];
      };
      User: {
        Row: {
          cidade: string | null;
          createdAt: string;
          curriculoUrl: string | null;
          email: string;
          id: string;
          nome: string;
          senha: string;
          telefone: string | null;
          uf: string | null;
          updatedAt: string;
          cpfCnpj: string | null;
          asaasCustomerId: string | null;
          asaasWalletId: string | null;
        };
        Insert: {
          cidade?: string | null;
          createdAt?: string;
          curriculoUrl?: string | null;
          email: string;
          id: string;
          nome: string;
          senha: string;
          telefone?: string | null;
          uf?: string | null;
          updatedAt?: string;
          cpfCnpj?: string | null;
          asaasCustomerId?: string | null;
          asaasWalletId?: string | null;
        };
        Update: {
          cidade?: string | null;
          createdAt?: string;
          curriculoUrl?: string | null;
          email?: string;
          id?: string;
          nome?: string;
          senha?: string;
          telefone?: string | null;
          uf?: string | null;
          updatedAt?: string;
          cpfCnpj?: string | null;
          asaasCustomerId?: string | null;
          asaasWalletId?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      BillingType: "PIX" | "CREDIT_CARD";
      JobStatus: "OPEN" | "CLOSED";
      ListingStatus: "OPEN" | "CLOSED" | "IN_PROGRESS";
      ListingType: "BICO" | "PRODUTO";
      TransactionStatus:
        | "PENDING"
        | "PAID"
        | "IN_DISPUTE"
        | "FAILED"
        | "CANCELED";
      SupportTicketStatus: "ABERTO" | "EM_ANALISE" | "RESOLVIDO";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;
